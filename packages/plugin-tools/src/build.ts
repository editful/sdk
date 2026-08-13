import { createHash, randomUUID } from 'node:crypto';
import {
  cp,
  mkdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';
import {
  MAX_PLUGIN_BUNDLE_BYTES,
  MAX_PLUGIN_WORKER_BYTES,
  validatePluginArtifact,
  type PluginManifest,
  type PluginWorkerDeclaration,
} from '@editful/plugin-artifact';
import { rolldown, type OutputAsset, type OutputChunk } from 'rolldown';
import { createPluginArchive } from './archive.js';
import {
  loadPluginConfig,
  type ResolvedEditfulPluginConfig,
} from './config.js';

export interface PluginBuildOptions {
  readonly projectDirectory?: string;
  readonly config?: string;
  readonly outputRoot?: string;
  readonly development?: boolean;
  readonly publish?: boolean;
}

export interface PluginBuildResult {
  readonly artifactDirectory: string;
  readonly manifest: PluginManifest;
  readonly bundleBytes: number;
  readonly maximumBundleBytes: number;
}

export interface PluginPackResult extends PluginBuildResult {
  readonly archivePath: string;
  readonly archiveBytes: number;
}

export async function buildPlugin(
  options: PluginBuildOptions = {},
): Promise<PluginBuildResult> {
  const config = await loadPluginConfig(
    options.projectDirectory ?? process.cwd(),
    options.config,
  );
  const outputRoot = options.outputRoot === undefined
    ? config.outputRoot
    : resolve(config.projectDirectory, options.outputRoot);
  if (outputRoot === parse(outputRoot).root) {
    throw new TypeError('The plugin output root cannot be a filesystem root');
  }
  const destination = join(outputRoot, config.artifactName);
  const stage = join(
    dirname(outputRoot),
    `.${basename(outputRoot)}-${config.artifactName}-${randomUUID()}`,
  );
  await mkdir(stage, { recursive: true });
  try {
    const result = await buildInto(config, stage, options.development ?? false);
    if (options.publish === false) return result;
    await mkdir(outputRoot, { recursive: true });
    await publishDirectory(stage, destination);
    return Object.freeze({ ...result, artifactDirectory: destination });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function checkPlugin(
  options: Omit<PluginBuildOptions, 'publish'> = {},
): Promise<PluginBuildResult> {
  return buildPlugin({ ...options, publish: false });
}

export async function packPlugin(
  options: PluginBuildOptions & { readonly archivePath?: string } = {},
): Promise<PluginPackResult> {
  const build = await buildPlugin(options);
  const destination = options.archivePath === undefined
    ? join(
        dirname(build.artifactDirectory),
        `${build.manifest.id.replace(':', '-')}-${build.manifest.version}.editful-plugin`,
      )
    : resolve(options.projectDirectory ?? process.cwd(), options.archivePath);
  const archive = await createPluginArchive(build.artifactDirectory, destination);
  return Object.freeze({
    ...build,
    archivePath: archive.path,
    archiveBytes: archive.byteLength,
  });
}

async function buildInto(
  config: ResolvedEditfulPluginConfig,
  directory: string,
  development: boolean,
): Promise<PluginBuildResult> {
  const bundle = await rolldown({
    input: config.entryPath,
    cwd: config.projectDirectory,
    platform: 'browser',
    transform: {
      define: {
        'process.env.NODE_ENV': JSON.stringify(
          development ? 'development' : 'production',
        ),
      },
    },
  });
  let output: readonly (OutputAsset | OutputChunk)[];
  try {
    output = (await bundle.generate({
      format: 'esm',
      codeSplitting: false,
      minify: !development,
      sourcemap: development ? 'inline' : false,
      entryFileNames: 'plugin.mjs',
    })).output;
  } finally {
    await bundle.close();
  }
  const chunks = output.filter((item): item is OutputChunk => item.type === 'chunk');
  const assets = output.filter((item): item is OutputAsset => item.type === 'asset');
  if (chunks.length !== 1 || chunks[0]?.isEntry !== true) {
    throw new Error(`Plugin build must produce exactly one entry chunk; received ${chunks.length}`);
  }
  if (assets.length > 0) {
    throw new Error(
      `Plugin build emitted unsupported auxiliary assets: ${assets.map(({ fileName }) => fileName).join(', ')}. Inline runtime assets and declare passive toolbar SVGs in config.assets.icons.`,
    );
  }
  const source = chunks[0].code;
  const bundleBytes = Buffer.byteLength(source);
  if (bundleBytes > MAX_PLUGIN_BUNDLE_BYTES) {
    throw new Error(
      `plugin.mjs is ${formatBytes(bundleBytes)}, exceeding Editful's ${formatBytes(MAX_PLUGIN_BUNDLE_BYTES)} limit`,
    );
  }
  await writeFile(join(directory, 'plugin.mjs'), source);
  await copyIcons(config, directory);
  const workers = await buildWorkers(config, directory, development);
  const manifest = createManifest(config, source, workers);
  await writeFile(
    join(directory, 'plugin.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const validated = await validatePluginArtifact(directory, {
    appVersion: config.minAppVersion,
    minSdkVersion: config.sdkVersion,
    maxSdkVersion: config.sdkVersion,
  });
  return Object.freeze({
    artifactDirectory: directory,
    manifest: validated.manifest,
    bundleBytes,
    maximumBundleBytes: MAX_PLUGIN_BUNDLE_BYTES,
  });
}

function createManifest(
  config: ResolvedEditfulPluginConfig,
  source: string,
  workers: readonly PluginWorkerDeclaration[],
): Record<string, unknown> {
  const common = {
    schemaVersion: config.schemaVersion,
    id: config.id,
    name: config.name,
    description: config.description,
    version: config.version,
    entry: 'plugin.mjs',
    sdkVersion: config.sdkVersion,
    minAppVersion: config.minAppVersion,
    capabilities: config.capabilities,
    entrySha256: createHash('sha256').update(source).digest('hex'),
    ...(config.author === undefined ? {} : { author: config.author }),
    ...(config.homepage === undefined ? {} : { homepage: config.homepage }),
    ...(config.source === undefined ? {} : { source: config.source }),
  };
  return config.schemaVersion === 1
    ? common
    : {
        ...common,
        network: config.network ?? [],
        remoteMedia: config.remoteMedia ?? [],
        settings: config.settings ?? [],
        secrets: config.secrets ?? [],
        workers,
      };
}

async function buildWorkers(
  config: ResolvedEditfulPluginConfig,
  destination: string,
  development: boolean,
): Promise<readonly PluginWorkerDeclaration[]> {
  const declarations: PluginWorkerDeclaration[] = [];
  const outputs = new Set<string>();
  for (const worker of config.assets?.workers ?? []) {
    if (
      typeof worker !== 'object' ||
      worker === null ||
      typeof worker.entry !== 'string' ||
      typeof worker.output !== 'string' ||
      !/^\.\/workers\/(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/)*[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.mjs$/u.test(worker.output) ||
      outputs.has(worker.output)
    ) {
      throw new TypeError('config.assets.workers entries require a unique portable ./workers/*.mjs output');
    }
    outputs.add(worker.output);
    const entry = resolve(config.projectDirectory, worker.entry);
    const child = relative(config.projectDirectory, entry);
    if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) {
      throw new TypeError(`Plugin worker escapes the project directory: ${worker.entry}`);
    }
    const bundle = await rolldown({
      input: entry,
      cwd: config.projectDirectory,
      platform: 'browser',
      transform: {
        define: {
          'process.env.NODE_ENV': JSON.stringify(
            development ? 'development' : 'production',
          ),
        },
      },
    });
    let output: readonly (OutputAsset | OutputChunk)[];
    try {
      output = (await bundle.generate({
        format: 'esm',
        codeSplitting: false,
        minify: !development,
        sourcemap: false,
        entryFileNames: 'worker.mjs',
      })).output;
    } finally {
      await bundle.close();
    }
    const chunks = output.filter((item): item is OutputChunk => item.type === 'chunk');
    const assets = output.filter((item): item is OutputAsset => item.type === 'asset');
    if (chunks.length !== 1 || chunks[0]?.isEntry !== true || assets.length > 0) {
      throw new Error(`Worker ${worker.entry} must bundle to one self-contained module`);
    }
    const source = chunks[0].code;
    const bytes = Buffer.byteLength(source);
    if (bytes > MAX_PLUGIN_WORKER_BYTES) {
      throw new Error(`Worker ${worker.entry} exceeds ${formatBytes(MAX_PLUGIN_WORKER_BYTES)}`);
    }
    const target = join(destination, worker.output.slice(2));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
    declarations.push(Object.freeze({
      path: worker.output,
      sha256: createHash('sha256').update(source).digest('hex'),
    }));
  }
  return Object.freeze(declarations.sort((left, right) =>
    left.path.localeCompare(right.path)
  ));
}

async function copyIcons(
  config: ResolvedEditfulPluginConfig,
  destination: string,
): Promise<void> {
  for (const declared of config.assets?.icons ?? []) {
    if (typeof declared !== 'string' || !declared.endsWith('.svg')) {
      throw new TypeError('config.assets.icons entries must be relative .svg paths');
    }
    const source = resolve(config.projectDirectory, declared);
    const child = relative(config.projectDirectory, source);
    if (
      isAbsolute(child) ||
      child === '..' ||
      child.startsWith(`..${sep}`)
    ) {
      throw new TypeError(`Plugin icon escapes the project directory: ${declared}`);
    }
    if (!(await stat(source)).isFile()) {
      throw new TypeError(`Plugin icon is not a regular file: ${declared}`);
    }
    const target = join(destination, child);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
  }
}

async function publishDirectory(stage: string, destination: string): Promise<void> {
  const outputRoot = dirname(destination);
  const backup = join(
    dirname(outputRoot),
    `.${basename(outputRoot)}-${basename(destination)}-previous-${randomUUID()}`,
  );
  let hadPrevious = false;
  try {
    await rename(destination, backup);
    hadPrevious = true;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  try {
    await rename(stage, destination);
  } catch (error) {
    if (hadPrevious) await rename(backup, destination);
    throw error;
  }
  if (hadPrevious) await rm(backup, { recursive: true, force: true });
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
