import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { realpath, readdir, lstat, open, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import {
  isValidationError,
  validationError,
} from './diagnostics.js';
import { parsePluginManifest } from './manifest.js';
import {
  RetainedPluginModule,
  decodePluginModule,
  validatePluginModuleSource,
} from './module-source.js';
import {
  MAX_PLUGIN_BUNDLE_BYTES,
  MAX_PLUGIN_ICON_BYTES,
  MAX_PLUGIN_ICON_COUNT,
  MAX_PLUGIN_ICON_TOTAL_BYTES,
  MAX_PLUGIN_MANIFEST_BYTES,
  PLUGIN_ENTRY_FILE,
  PLUGIN_MANIFEST_FILE,
  type PluginArtifactValidationOptions,
  type PluginArtifactValidationResult,
  type ValidatedPluginArtifact,
  type ValidatedPluginIcon,
} from './types.js';

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

async function readBoundedRegularFile(
  path: string,
  maximumBytes: number,
  kind: 'manifest' | 'entry',
): Promise<Uint8Array> {
  let handle;
  try {
    handle = await open(path, 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw validationError(
        'corrupt',
        kind === 'manifest'
          ? 'MANIFEST_NOT_REGULAR'
          : 'ENTRY_NOT_REGULAR',
        `${kind === 'manifest' ? PLUGIN_MANIFEST_FILE : PLUGIN_ENTRY_FILE} is not a regular file`,
        { path },
      );
    }
    if (metadata.size > maximumBytes) {
      throw validationError(
        'unsupported',
        kind === 'manifest' ? 'MANIFEST_TOO_LARGE' : 'ENTRY_TOO_LARGE',
        `${kind === 'manifest' ? PLUGIN_MANIFEST_FILE : PLUGIN_ENTRY_FILE} exceeds the ${maximumBytes}-byte limit`,
        { path },
      );
    }
    // Read at most limit + 1. `FileHandle.readFile()` would trust the earlier
    // stat for allocation, allowing a file that grows during validation to
    // turn a 2 MiB policy into an unbounded read.
    const buffer = Buffer.allocUnsafe(maximumBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const result = await handle.read(
        buffer,
        offset,
        buffer.byteLength - offset,
        offset,
      );
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > maximumBytes) {
      throw validationError(
        'unsupported',
        kind === 'manifest' ? 'MANIFEST_TOO_LARGE' : 'ENTRY_TOO_LARGE',
        `${kind === 'manifest' ? PLUGIN_MANIFEST_FILE : PLUGIN_ENTRY_FILE} exceeds the ${maximumBytes}-byte limit`,
        { path },
      );
    }
    return Buffer.from(buffer.subarray(0, offset));
  } finally {
    await handle?.close();
  }
}

function isContained(directory: string, path: string): boolean {
  const child = relative(directory, path);
  return child !== '' && !isAbsolute(child) && child !== '..' &&
    !child.startsWith(`..${sep}`);
}

async function validatePluginArtifactInner(
  directory: string,
  options: PluginArtifactValidationOptions,
): Promise<ValidatedPluginArtifact> {
  let canonicalDirectory: string;
  try {
    canonicalDirectory = await realpath(directory);
  } catch (cause) {
    if (errorCode(cause) === 'ENOENT') {
      throw validationError(
        'missing',
        'ARTIFACT_NOT_FOUND',
        `Plugin artifact directory does not exist: ${directory}`,
        { path: directory, cause },
      );
    }
    throw validationError(
      'corrupt',
      'ARTIFACT_UNREADABLE',
      `Plugin artifact directory cannot be resolved: ${directory}`,
      { path: directory, cause },
    );
  }

  let directoryStat;
  try {
    directoryStat = await stat(canonicalDirectory);
  } catch (cause) {
    throw validationError(
      errorCode(cause) === 'ENOENT' ? 'missing' : 'corrupt',
      errorCode(cause) === 'ENOENT'
        ? 'ARTIFACT_NOT_FOUND'
        : 'ARTIFACT_UNREADABLE',
      `Plugin artifact directory cannot be read: ${canonicalDirectory}`,
      { path: canonicalDirectory, cause },
    );
  }
  if (!directoryStat.isDirectory()) {
    throw validationError(
      'malformed',
      'ARTIFACT_NOT_DIRECTORY',
      `Plugin artifact path is not a directory: ${canonicalDirectory}`,
      { path: canonicalDirectory },
    );
  }

  let entries;
  try {
    entries = await readdir(canonicalDirectory, { withFileTypes: true });
  } catch (cause) {
    throw validationError(
      'corrupt',
      'ARTIFACT_UNREADABLE',
      `Plugin artifact directory cannot be listed: ${canonicalDirectory}`,
      { path: canonicalDirectory, cause },
    );
  }
  const names = entries.map((entry) => entry.name).sort();
  if (!names.includes(PLUGIN_MANIFEST_FILE)) {
    throw validationError(
      'missing',
      'MANIFEST_MISSING',
      `Plugin artifact is missing ${PLUGIN_MANIFEST_FILE}`,
      { path: canonicalDirectory },
    );
  }
  if (!names.includes(PLUGIN_ENTRY_FILE)) {
    throw validationError(
      'missing',
      'ENTRY_MISSING',
      `Plugin artifact is missing ${PLUGIN_ENTRY_FILE}`,
      { path: canonicalDirectory },
    );
  }
  if (
    entries.some(
      (entry) =>
        entry.name !== PLUGIN_MANIFEST_FILE &&
        entry.name !== PLUGIN_ENTRY_FILE &&
        !entry.isDirectory() &&
        !(entry.isFile() && entry.name.endsWith('.svg')),
    )
  ) {
    throw validationError(
      'unsupported',
      'ARTIFACT_FILES_UNSUPPORTED',
      `A plugin artifact may contain only ${PLUGIN_MANIFEST_FILE}, ${PLUGIN_ENTRY_FILE}, and relative .svg icon assets`,
      { path: canonicalDirectory },
    );
  }

  const manifestPath = join(canonicalDirectory, PLUGIN_MANIFEST_FILE);
  const manifestEntry = entries.find(
    (entry) => entry.name === PLUGIN_MANIFEST_FILE,
  )!;
  if (!manifestEntry.isFile()) {
    throw validationError(
      'corrupt',
      'MANIFEST_NOT_REGULAR',
      `${PLUGIN_MANIFEST_FILE} is not a regular file`,
      { path: manifestPath },
    );
  }

  let manifestBytes: Uint8Array;
  try {
    manifestBytes = await readBoundedRegularFile(
      manifestPath,
      MAX_PLUGIN_MANIFEST_BYTES,
      'manifest',
    );
  } catch (cause) {
    if (isValidationError(cause)) throw cause;
    throw validationError(
      errorCode(cause) === 'ENOENT' ? 'missing' : 'corrupt',
      errorCode(cause) === 'ENOENT'
        ? 'MANIFEST_MISSING'
        : 'ARTIFACT_UNREADABLE',
      `${PLUGIN_MANIFEST_FILE} cannot be read`,
      { path: manifestPath, cause },
    );
  }
  const manifest = parsePluginManifest(manifestBytes, options);
  const manifestDigest = createHash('sha256')
    .update(manifestBytes)
    .digest('hex');

  const entryPath = join(canonicalDirectory, manifest.entry);
  let resolvedEntry: string;
  try {
    resolvedEntry = await realpath(entryPath);
  } catch (cause) {
    throw validationError(
      errorCode(cause) === 'ENOENT' ? 'missing' : 'corrupt',
      errorCode(cause) === 'ENOENT'
        ? 'ENTRY_MISSING'
        : 'ARTIFACT_UNREADABLE',
      `${PLUGIN_ENTRY_FILE} cannot be resolved`,
      { path: entryPath, pluginId: manifest.id, cause },
    );
  }
  if (!isContained(canonicalDirectory, resolvedEntry)) {
    throw validationError(
      'corrupt',
      'ENTRY_ESCAPES_ARTIFACT',
      `${PLUGIN_ENTRY_FILE} escapes its artifact directory`,
      { path: entryPath, pluginId: manifest.id },
    );
  }

  let entryLinkStat;
  try {
    entryLinkStat = await lstat(entryPath);
  } catch (cause) {
    throw validationError(
      errorCode(cause) === 'ENOENT' ? 'missing' : 'corrupt',
      errorCode(cause) === 'ENOENT'
        ? 'ENTRY_MISSING'
        : 'ARTIFACT_UNREADABLE',
      `${PLUGIN_ENTRY_FILE} cannot be inspected`,
      { path: entryPath, pluginId: manifest.id, cause },
    );
  }
  if (!entryLinkStat.isFile()) {
    throw validationError(
      'corrupt',
      'ENTRY_NOT_REGULAR',
      `${PLUGIN_ENTRY_FILE} must be a regular file, not a symlink or special entry`,
      { path: entryPath, pluginId: manifest.id },
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedRegularFile(
      resolvedEntry,
      MAX_PLUGIN_BUNDLE_BYTES,
      'entry',
    );
  } catch (cause) {
    if (isValidationError(cause)) throw cause;
    throw validationError(
      errorCode(cause) === 'ENOENT' ? 'missing' : 'corrupt',
      errorCode(cause) === 'ENOENT'
        ? 'ENTRY_MISSING'
        : 'ARTIFACT_UNREADABLE',
      `${PLUGIN_ENTRY_FILE} cannot be read`,
      { path: resolvedEntry, pluginId: manifest.id, cause },
    );
  }

  const source = decodePluginModule(bytes, manifest.id);
  const retained = new RetainedPluginModule(bytes, source);
  if (retained.digest !== manifest.entrySha256) {
    throw validationError(
      'corrupt',
      'ENTRY_DIGEST_MISMATCH',
      `${PLUGIN_ENTRY_FILE} digest does not match ${PLUGIN_MANIFEST_FILE}`,
      { path: resolvedEntry, pluginId: manifest.id },
    );
  }
  await validatePluginModuleSource(source, manifest.id);
  const module = options.cache?.retain(retained) ?? retained;
  const icons = await collectPluginIcons(
    canonicalDirectory,
    entries.filter(
      ({ name }) =>
        name !== PLUGIN_MANIFEST_FILE && name !== PLUGIN_ENTRY_FILE,
    ),
    manifest.id,
  );

  return Object.freeze({
    directory: canonicalDirectory,
    manifestDigest,
    manifest,
    module,
    icons,
  });
}

async function collectPluginIcons(
  directory: string,
  rootEntries: readonly Dirent[],
  pluginId: string,
): Promise<readonly ValidatedPluginIcon[]> {
  const icons: ValidatedPluginIcon[] = [];
  let totalBytes = 0;

  const visit = async (
    parent: string,
    entries: readonly Dirent[],
    depth: number,
  ): Promise<void> => {
    for (const entry of [...entries].sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      const path = join(parent, entry.name);
      if (entry.isDirectory()) {
        if (depth >= 4) {
          throw validationError(
            'unsupported',
            'ICON_PATH_INVALID',
            'Plugin icon paths may be at most four directories deep',
            { path, pluginId },
          );
        }
        let children;
        try {
          children = await readdir(path, { withFileTypes: true });
        } catch (cause) {
          throw validationError(
            'corrupt',
            'ARTIFACT_UNREADABLE',
            `Plugin icon directory cannot be listed: ${path}`,
            { path, pluginId, cause },
          );
        }
        await visit(path, children, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.svg')) {
        throw validationError(
          'unsupported',
          'ARTIFACT_FILES_UNSUPPORTED',
          'Plugin asset directories may contain only regular .svg files',
          { path, pluginId },
        );
      }
      if (icons.length >= MAX_PLUGIN_ICON_COUNT) {
        throw validationError(
          'unsupported',
          'ICON_COUNT_EXCEEDED',
          `A plugin may contain at most ${MAX_PLUGIN_ICON_COUNT} SVG icons`,
          { path, pluginId },
        );
      }
      const relativePath = relative(directory, path).split(sep).join('/');
      const iconPath = `./${relativePath}`;
      if (
        iconPath.length > 240 ||
        relativePath.split('/').some(
          (segment) =>
            !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(segment),
        )
      ) {
        throw validationError(
          'unsupported',
          'ICON_PATH_INVALID',
          `Plugin icon path is not portable: ${iconPath}`,
          { path, pluginId },
        );
      }
      const bytes = await readPluginIcon(path, pluginId);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_PLUGIN_ICON_TOTAL_BYTES) {
        throw validationError(
          'unsupported',
          'ICON_TOO_LARGE',
          `Plugin icons exceed the ${MAX_PLUGIN_ICON_TOTAL_BYTES}-byte combined limit`,
          { path, pluginId },
        );
      }
      let source: string;
      try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (cause) {
        throw validationError(
          'malformed',
          'ICON_INVALID_UTF8',
          `${iconPath} is not valid UTF-8`,
          { path, pluginId, cause },
        );
      }
      validateSvgIcon(source, iconPath, path, pluginId);
      icons.push(Object.freeze({
        path: iconPath,
        digest: createHash('sha256').update(bytes).digest('hex'),
        source,
        byteLength: bytes.byteLength,
      }));
    }
  };

  await visit(directory, rootEntries, 0);
  return Object.freeze(icons);
}

async function readPluginIcon(
  path: string,
  pluginId: string,
): Promise<Uint8Array> {
  let handle;
  try {
    handle = await open(path, 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw validationError(
        'corrupt',
        'ICON_NOT_REGULAR',
        'Plugin icon must be a regular SVG file',
        { path, pluginId },
      );
    }
    if (metadata.size > MAX_PLUGIN_ICON_BYTES) {
      throw validationError(
        'unsupported',
        'ICON_TOO_LARGE',
        `Plugin icon exceeds the ${MAX_PLUGIN_ICON_BYTES}-byte limit`,
        { path, pluginId },
      );
    }
    const buffer = Buffer.allocUnsafe(MAX_PLUGIN_ICON_BYTES + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const result = await handle.read(
        buffer,
        offset,
        buffer.byteLength - offset,
        offset,
      );
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > MAX_PLUGIN_ICON_BYTES) {
      throw validationError(
        'unsupported',
        'ICON_TOO_LARGE',
        `Plugin icon exceeds the ${MAX_PLUGIN_ICON_BYTES}-byte limit`,
        { path, pluginId },
      );
    }
    return Buffer.from(buffer.subarray(0, offset));
  } catch (cause) {
    if (isValidationError(cause)) throw cause;
    throw validationError(
      'corrupt',
      'ARTIFACT_UNREADABLE',
      `Plugin icon cannot be read: ${path}`,
      { path, pluginId, cause },
    );
  } finally {
    await handle?.close();
  }
}

function validateSvgIcon(
  source: string,
  iconPath: string,
  path: string,
  pluginId: string,
): void {
  const trimmed = source.trim();
  if (
    !/^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/iu.test(trimmed) ||
    !/<\/svg>$/iu.test(trimmed) ||
    /<\s*(?:script|foreignObject|iframe|object|embed|audio|video)\b/iu.test(trimmed) ||
    /<!\s*(?:doctype|entity)\b/iu.test(trimmed) ||
    /\s(?:href|src|on[a-z]+)\s*=/iu.test(trimmed) ||
    /url\(\s*['"]?(?:https?:|\/\/|data:)/iu.test(trimmed)
  ) {
    throw validationError(
      'unsupported',
      'ICON_SVG_INVALID',
      `${iconPath} must be a self-contained, passive SVG`,
      { path, pluginId },
    );
  }
}

/**
 * Validates one explicit artifact directory without discovery or code
 * execution. Failures throw `PluginArtifactValidationError`.
 */
export async function validatePluginArtifact(
  directory: string,
  options: PluginArtifactValidationOptions,
): Promise<ValidatedPluginArtifact> {
  return validatePluginArtifactInner(directory, options);
}

/** Result-shaped companion for UI and batch discovery callers. */
export async function validatePluginArtifactResult(
  directory: string,
  options: PluginArtifactValidationOptions,
): Promise<PluginArtifactValidationResult> {
  try {
    return Object.freeze({
      ok: true,
      value: await validatePluginArtifactInner(directory, options),
    });
  } catch (error) {
    if (!isValidationError(error)) throw error;
    return Object.freeze({
      ok: false,
      diagnostic: error.diagnostic,
    });
  }
}
