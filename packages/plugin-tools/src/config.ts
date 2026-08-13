import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PLUGIN_CAPABILITIES,
  type PluginCapability,
  type PluginNetworkDeclaration,
  type PluginRemoteMediaDeclaration,
  type PluginSecretDeclaration,
  type PluginSettingDeclaration,
} from '@editful/plugin-artifact';

const CONFIG_FILES = Object.freeze([
  'editful.plugin.ts',
  'editful.plugin.mts',
  'editful.plugin.js',
  'editful.plugin.mjs',
]);

const CONFIG_KEYS = new Set([
  'schemaVersion',
  'id',
  'name',
  'description',
  'version',
  'entry',
  'sdkVersion',
  'minAppVersion',
  'maxAppVersion',
  'capabilities',
  'network',
  'remoteMedia',
  'settings',
  'secrets',
  'author',
  'homepage',
  'source',
  'assets',
  'outDir',
]);
const PLUGIN_ID = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

export interface EditfulPluginAssets {
  /** Passive SVG toolbar icons copied into the artifact at the same path. */
  readonly icons?: readonly string[];
  /** Module-worker entries bundled as self-contained, validated artifacts. */
  readonly workers?: readonly {
    readonly entry: string;
    /** Plugin-relative output path, for example `./workers/render.mjs`. */
    readonly output: string;
  }[];
}

export interface EditfulPluginConfig {
  readonly schemaVersion?: 1 | 2;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  /** Project-relative TypeScript, TSX, or JavaScript source entry. */
  readonly entry: string;
  /** Inferred from the installed SDK when omitted. */
  readonly sdkVersion?: string;
  readonly minAppVersion: string;
  /** @deprecated Accepted for source compatibility and omitted from builds. */
  readonly maxAppVersion?: string;
  readonly capabilities: readonly PluginCapability[];
  readonly network?: readonly PluginNetworkDeclaration[];
  readonly remoteMedia?: readonly PluginRemoteMediaDeclaration[];
  readonly settings?: readonly PluginSettingDeclaration[];
  readonly secrets?: readonly PluginSecretDeclaration[];
  readonly author?: string;
  readonly homepage?: string;
  readonly source?: string;
  readonly assets?: EditfulPluginAssets;
  /** Project-relative artifact root. Defaults to `dist`. */
  readonly outDir?: string;
}

export interface ResolvedEditfulPluginConfig
  extends Omit<EditfulPluginConfig, 'schemaVersion' | 'sdkVersion' | 'entry' | 'outDir'> {
  readonly schemaVersion: 1 | 2;
  readonly sdkVersion: string;
  readonly projectDirectory: string;
  readonly configPath: string;
  readonly entryPath: string;
  readonly outputRoot: string;
  readonly artifactName: string;
}

export function definePluginConfig<const Config extends EditfulPluginConfig>(
  config: Config,
): Config {
  return config;
}

export async function loadPluginConfig(
  projectDirectory: string,
  explicitPath?: string,
): Promise<ResolvedEditfulPluginConfig> {
  const project = resolve(projectDirectory);
  const configPath = explicitPath === undefined
    ? await findConfig(project)
    : resolve(project, explicitPath);
  const imported = await import(
    `${pathToFileURL(configPath).href}?editful=${Date.now()}`
  ) as { default?: unknown };
  if (!isObject(imported.default)) {
    throw new TypeError(`${configPath} must default-export an Editful plugin config`);
  }
  const raw = imported.default;
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new TypeError(`Plugin config contains unsupported key ${JSON.stringify(key)}`);
    }
  }

  const schemaVersion = raw.schemaVersion === undefined
    ? 2
    : requiredSchemaVersion(raw.schemaVersion);
  const id = requiredString(raw.id, 'id');
  if (!PLUGIN_ID.test(id)) {
    throw new TypeError('id must match lowercase publisher:name syntax');
  }
  const entry = requiredRelativePath(raw.entry, 'entry');
  const outDir = raw.outDir === undefined
    ? 'dist'
    : requiredRelativePath(raw.outDir, 'outDir');
  const capabilities = canonicalCapabilities(raw.capabilities, schemaVersion);
  const sdkVersion = raw.sdkVersion === undefined
    ? await installedSdkVersion(project)
    : requiredString(raw.sdkVersion, 'sdkVersion');

  const config = raw as unknown as EditfulPluginConfig;
  return Object.freeze({
    ...config,
    schemaVersion,
    id,
    name: requiredString(raw.name, 'name'),
    description: requiredString(raw.description, 'description'),
    version: requiredString(raw.version, 'version'),
    minAppVersion: requiredString(raw.minAppVersion, 'minAppVersion'),
    capabilities,
    sdkVersion,
    projectDirectory: project,
    configPath,
    entryPath: resolve(project, entry),
    outputRoot: resolve(project, outDir),
    artifactName: id.replace(':', '-'),
  });
}

async function findConfig(project: string): Promise<string> {
  for (const name of CONFIG_FILES) {
    const candidate = join(project, name);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next supported extension.
    }
  }
  throw new Error(
    `No Editful plugin config found in ${project}; expected ${CONFIG_FILES.join(', ')}`,
  );
}

async function installedSdkVersion(project: string): Promise<string> {
  const require = createRequire(join(project, 'package.json'));
  let entry: string;
  try {
    entry = require.resolve('@editful/canvas-sdk');
  } catch (cause) {
    throw new Error(
      'Cannot infer sdkVersion because @editful/canvas-sdk is not installed',
      { cause },
    );
  }
  const sdk = await import(pathToFileURL(entry).href) as {
    EDITFUL_PLUGIN_API_VERSION?: unknown;
  };
  if (typeof sdk.EDITFUL_PLUGIN_API_VERSION === 'string') {
    return sdk.EDITFUL_PLUGIN_API_VERSION;
  }
  throw new Error(
    'Installed @editful/canvas-sdk does not declare EDITFUL_PLUGIN_API_VERSION',
  );
}

function canonicalCapabilities(
  value: unknown,
  schemaVersion: 1 | 2,
): readonly PluginCapability[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('capabilities must be a non-empty array');
  }
  const requested = new Set<PluginCapability>();
  for (const capability of value) {
    if (
      typeof capability !== 'string' ||
      !PLUGIN_CAPABILITIES.includes(capability as PluginCapability)
    ) {
      throw new TypeError(`Unsupported plugin capability ${JSON.stringify(capability)}`);
    }
    requested.add(capability as PluginCapability);
  }
  const result = PLUGIN_CAPABILITIES.filter((capability) => requested.has(capability));
  if (result.length !== value.length) {
    throw new TypeError('capabilities must not contain duplicates');
  }
  if (schemaVersion === 1 && (result.length !== 1 || result[0] !== 'node-kinds')) {
    throw new TypeError('Schema 1 supports only the node-kinds capability');
  }
  return Object.freeze(result);
}

function requiredSchemaVersion(value: unknown): 1 | 2 {
  if (value !== 1 && value !== 2) {
    throw new TypeError('schemaVersion must be 1 or 2');
  }
  return value;
}

function requiredString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${key} must be a non-empty string`);
  }
  return value;
}

function requiredRelativePath(value: unknown, key: string): string {
  const path = requiredString(value, key);
  if (isAbsolute(path) || relative('.', path).startsWith('..')) {
    throw new TypeError(`${key} must be a project-relative path`);
  }
  return path;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
