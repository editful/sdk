import {
  MAX_PLUGIN_MANIFEST_BYTES,
  PLUGIN_CAPABILITIES,
  PLUGIN_ENTRY_FILE,
  type PluginCompatibilityContext,
  type PluginManifest,
  type PluginManifestV1,
  type PluginManifestV2,
  type PluginNetworkDeclaration,
  type PluginNetworkMethod,
  type PluginRemoteMediaDeclaration,
  type PluginRemoteMediaType,
  type PluginSecretDeclaration,
  type PluginSettingDeclaration,
  type PluginWorkerDeclaration,
} from './types.js';
import {
  isValidationError,
  validationError,
} from './diagnostics.js';

const V1_MANIFEST_KEYS = new Set([
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
  'entrySha256',
  'author',
  'homepage',
  'source',
]);
const V2_MANIFEST_KEYS = new Set([
  ...V1_MANIFEST_KEYS,
  'network',
  'remoteMedia',
  'settings',
  'secrets',
  'workers',
]);

const ID = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
const DECLARATION_KEY = /^[a-z][a-z0-9-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// SemVer 2.0.0, including optional pre-release and build identifiers.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
type JsonObject = Record<string, unknown>;
type StableVersion = readonly [number, number, number];
const NETWORK_METHODS = Object.freeze([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const satisfies readonly PluginNetworkMethod[]);
const REMOTE_MEDIA_TYPES = Object.freeze([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const satisfies readonly PluginRemoteMediaType[]);

function hasForbiddenControl(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      code === 0x7f ||
      (code >= 0x00 &&
        code <= 0x1f &&
        code !== 0x09 &&
        code !== 0x0a &&
        code !== 0x0d)
    ) {
      return true;
    }
  }
  return false;
}

function malformed(
  message: string,
  pluginId?: string,
): never {
  throw validationError(
    'malformed',
    'MANIFEST_FIELD_INVALID',
    message,
    { pluginId },
  );
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(
  object: JsonObject,
  key: string,
  maximum: number,
  pluginId?: string,
): string {
  const value = object[key];
  if (typeof value !== 'string' || value.length === 0) {
    malformed(`${key} must be a non-empty string`, pluginId);
  }
  if (value !== value.trim()) {
    malformed(`${key} must not contain leading or trailing whitespace`, pluginId);
  }
  if (value.length > maximum) {
    malformed(`${key} exceeds its ${maximum}-character limit`, pluginId);
  }
  if (hasForbiddenControl(value)) {
    malformed(`${key} contains unsupported control characters`, pluginId);
  }
  return value;
}

function optionalString(
  object: JsonObject,
  key: string,
  maximum: number,
  pluginId: string,
): string | undefined {
  if (object[key] === undefined) return undefined;
  return requiredString(object, key, maximum, pluginId);
}

function semver(value: string, name: string, pluginId?: string): string {
  if (!SEMVER.test(value)) {
    malformed(`${name} must be a valid SemVer version`, pluginId);
  }
  return value;
}

function stableVersion(
  value: string,
  name: string,
  pluginId?: string,
): StableVersion {
  const match = STABLE_VERSION.exec(value);
  if (match === null) {
    malformed(`${name} must be a stable major.minor.patch version`, pluginId);
  }
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (!parts.every(Number.isSafeInteger)) {
    malformed(`${name} contains a numeric component that is too large`, pluginId);
  }
  return parts;
}

function hostStableVersion(value: string, name: string): StableVersion {
  const match = STABLE_VERSION.exec(value);
  if (match === null) {
    throw new TypeError(
      `${name} must be a stable major.minor.patch version; received ${JSON.stringify(value)}`,
    );
  }
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (!parts.every(Number.isSafeInteger)) {
    throw new TypeError(`${name} contains a numeric component that is too large`);
  }
  return parts;
}

function compareVersions(left: StableVersion, right: StableVersion): number {
  for (let index = 0; index < 3; index++) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function metadataUrl(
  object: JsonObject,
  key: 'homepage' | 'source',
  pluginId: string,
): string | undefined {
  const value = optionalString(object, key, 2_048, pluginId);
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    malformed(`${key} must be an absolute HTTP(S) URL`, pluginId);
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    malformed(`${key} must be an absolute HTTP(S) URL without credentials`, pluginId);
  }
  return url.href;
}

function assertExactKeys(
  object: JsonObject,
  keys: ReadonlySet<string>,
  context: string,
  pluginId?: string,
): void {
  for (const key of Object.keys(object)) {
    if (!keys.has(key)) {
      throw validationError(
        'unsupported',
        'MANIFEST_KEY_UNSUPPORTED',
        `${context} contains unsupported key ${JSON.stringify(key)}`,
        { pluginId },
      );
    }
  }
}

function requiredArray(
  object: JsonObject,
  key: string,
  maximum: number,
  pluginId: string,
): readonly unknown[] {
  const value = object[key];
  if (!Array.isArray(value)) {
    malformed(`${key} must be an array`, pluginId);
  }
  if (value.length > maximum) {
    malformed(`${key} exceeds its ${maximum}-item limit`, pluginId);
  }
  return value;
}

function exactHttpsOrigin(
  value: unknown,
  key: string,
  pluginId: string,
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    malformed(`${key} must be a non-empty HTTPS origin`, pluginId);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    malformed(`${key} must be an exact HTTPS origin`, pluginId);
  }
  if (
    url.protocol !== 'https:' ||
    value.includes('*') ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    value !== url.origin
  ) {
    malformed(
      `${key} must be a canonical HTTPS origin without credentials, port, path, query, fragment, or wildcard`,
      pluginId,
    );
  }
  return value;
}

function canonicalStringSubset<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  key: string,
  pluginId: string,
): readonly Value[] {
  if (!Array.isArray(value) || value.length === 0) {
    malformed(`${key} must be a non-empty array`, pluginId);
  }
  const indexes = new Map(allowed.map((entry, index) => [entry, index]));
  let previous = -1;
  const result: Value[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !indexes.has(entry as Value)) {
      throw validationError(
        'unsupported',
        'CAPABILITY_UNSUPPORTED',
        `${key} contains unsupported value ${JSON.stringify(entry)}`,
        { pluginId },
      );
    }
    const index = indexes.get(entry as Value)!;
    if (index <= previous) {
      malformed(
        `${key} must contain unique values in canonical order`,
        pluginId,
      );
    }
    previous = index;
    result.push(entry as Value);
  }
  return Object.freeze(result);
}

function declarationKey(
  object: JsonObject,
  key: 'key' | 'name' | 'secret',
  pluginId: string,
): string {
  const value = requiredString(object, key, 64, pluginId);
  if (!DECLARATION_KEY.test(value)) {
    malformed(
      `${key} must match lowercase [a-z][a-z0-9-]*`,
      pluginId,
    );
  }
  return value;
}

function uniqueDeclarations<Value>(
  values: readonly unknown[],
  nameOf: (entry: unknown, index: number) => string,
  parse: (entry: unknown, index: number) => Value,
  label: string,
  pluginId: string,
): readonly Value[] {
  const names = new Set<string>();
  const result = values.map((entry, index) => {
    const name = nameOf(entry, index);
    if (names.has(name)) {
      malformed(`${label} contains duplicate declaration ${JSON.stringify(name)}`, pluginId);
    }
    names.add(name);
    return parse(entry, index);
  });
  return Object.freeze(result);
}

function parseNetwork(
  parsed: JsonObject,
  pluginId: string,
): readonly PluginNetworkDeclaration[] {
  const values = parsed.network === undefined
    ? []
    : requiredArray(parsed, 'network', 16, pluginId);
  return uniqueDeclarations(
    values,
    (entry, index) => {
      if (!isObject(entry)) malformed(`network[${index}] must be an object`, pluginId);
      return exactHttpsOrigin(entry.origin, `network[${index}].origin`, pluginId);
    },
    (entry, index) => {
      if (!isObject(entry)) malformed(`network[${index}] must be an object`, pluginId);
      assertExactKeys(
        entry,
        new Set(['origin', 'methods', 'purpose']),
        `network[${index}]`,
        pluginId,
      );
      return Object.freeze({
        origin: exactHttpsOrigin(entry.origin, `network[${index}].origin`, pluginId),
        methods: canonicalStringSubset(
          entry.methods,
          NETWORK_METHODS,
          `network[${index}].methods`,
          pluginId,
        ),
        purpose: requiredString(entry, 'purpose', 240, pluginId),
      });
    },
    'network',
    pluginId,
  );
}

function parseRemoteMedia(
  parsed: JsonObject,
  pluginId: string,
): readonly PluginRemoteMediaDeclaration[] {
  const values = parsed.remoteMedia === undefined
    ? []
    : requiredArray(parsed, 'remoteMedia', 16, pluginId);
  return uniqueDeclarations(
    values,
    (entry, index) => {
      if (!isObject(entry)) malformed(`remoteMedia[${index}] must be an object`, pluginId);
      return exactHttpsOrigin(entry.origin, `remoteMedia[${index}].origin`, pluginId);
    },
    (entry, index) => {
      if (!isObject(entry)) malformed(`remoteMedia[${index}] must be an object`, pluginId);
      assertExactKeys(
        entry,
        new Set(['origin', 'mediaTypes', 'purpose']),
        `remoteMedia[${index}]`,
        pluginId,
      );
      return Object.freeze({
        origin: exactHttpsOrigin(entry.origin, `remoteMedia[${index}].origin`, pluginId),
        mediaTypes: canonicalStringSubset(
          entry.mediaTypes,
          REMOTE_MEDIA_TYPES,
          `remoteMedia[${index}].mediaTypes`,
          pluginId,
        ),
        purpose: requiredString(entry, 'purpose', 240, pluginId),
      });
    },
    'remoteMedia',
    pluginId,
  );
}

function parseSettings(
  parsed: JsonObject,
  pluginId: string,
): readonly PluginSettingDeclaration[] {
  const values = parsed.settings === undefined
    ? []
    : requiredArray(parsed, 'settings', 64, pluginId);
  return uniqueDeclarations(
    values,
    (entry, index) => {
      if (!isObject(entry)) malformed(`settings[${index}] must be an object`, pluginId);
      return declarationKey(entry, 'key', pluginId);
    },
    (entry, index) => {
      if (!isObject(entry)) malformed(`settings[${index}] must be an object`, pluginId);
      const type = entry.type;
      if (
        type !== 'string' &&
        type !== 'number' &&
        type !== 'boolean' &&
        type !== 'enum' &&
        type !== 'secret-ref'
      ) {
        malformed(`settings[${index}].type is unsupported`, pluginId);
      }
      const common = {
        key: declarationKey(entry, 'key', pluginId),
        label: requiredString(entry, 'label', 100, pluginId),
        description: requiredString(entry, 'description', 500, pluginId),
      };
      if (type === 'secret-ref') {
        assertExactKeys(
          entry,
          new Set(['key', 'label', 'description', 'type', 'secret']),
          `settings[${index}]`,
          pluginId,
        );
        return Object.freeze({
          ...common,
          type,
          secret: declarationKey(entry, 'secret', pluginId),
        });
      }
      if (type === 'enum') {
        assertExactKeys(
          entry,
          new Set(['key', 'label', 'description', 'type', 'values', 'default']),
          `settings[${index}]`,
          pluginId,
        );
        if (!Array.isArray(entry.values) || entry.values.length === 0) {
          malformed(
            `settings[${index}].values must be a non-empty array`,
            pluginId,
          );
        }
        if (entry.values.some((value) => typeof value !== 'string')) {
          malformed(
            `settings[${index}].values must contain strings`,
            pluginId,
          );
        }
        const enumValues = entry.values as string[];
        if (new Set(enumValues).size !== enumValues.length) {
          malformed(
            `settings[${index}].values must contain unique values`,
            pluginId,
          );
        }
        if (enumValues.length > 32 || enumValues.some((value) => value.length > 100)) {
          malformed(`settings[${index}].values exceeds its limits`, pluginId);
        }
        if (
          entry.default !== undefined &&
          (typeof entry.default !== 'string' || !enumValues.includes(entry.default))
        ) {
          malformed(`settings[${index}].default must be one of its values`, pluginId);
        }
        return Object.freeze({
          ...common,
          type,
          values: Object.freeze([...enumValues]),
          ...(entry.default === undefined ? {} : { default: entry.default }),
        });
      }
      assertExactKeys(
        entry,
        new Set(['key', 'label', 'description', 'type', 'default']),
        `settings[${index}]`,
        pluginId,
      );
      if (
        entry.default !== undefined &&
        typeof entry.default !== type
      ) {
        malformed(`settings[${index}].default must be a ${type}`, pluginId);
      }
      if (
        typeof entry.default === 'number' &&
        !Number.isFinite(entry.default)
      ) {
        malformed(`settings[${index}].default must be finite`, pluginId);
      }
      if (
        typeof entry.default === 'string' &&
        entry.default.length > 4_096
      ) {
        malformed(`settings[${index}].default exceeds its limit`, pluginId);
      }
      return Object.freeze({
        ...common,
        type,
        ...(entry.default === undefined ? {} : { default: entry.default }),
      }) as PluginSettingDeclaration;
    },
    'settings',
    pluginId,
  );
}

function parseSecrets(
  parsed: JsonObject,
  pluginId: string,
): readonly PluginSecretDeclaration[] {
  const values = parsed.secrets === undefined
    ? []
    : requiredArray(parsed, 'secrets', 32, pluginId);
  return uniqueDeclarations(
    values,
    (entry, index) => {
      if (!isObject(entry)) malformed(`secrets[${index}] must be an object`, pluginId);
      return declarationKey(entry, 'name', pluginId);
    },
    (entry, index) => {
      if (!isObject(entry)) malformed(`secrets[${index}] must be an object`, pluginId);
      assertExactKeys(
        entry,
        new Set(['name', 'label', 'description', 'required']),
        `secrets[${index}]`,
        pluginId,
      );
      if (typeof entry.required !== 'boolean') {
        malformed(`secrets[${index}].required must be a boolean`, pluginId);
      }
      return Object.freeze({
        name: declarationKey(entry, 'name', pluginId),
        label: requiredString(entry, 'label', 100, pluginId),
        description: requiredString(entry, 'description', 500, pluginId),
        required: entry.required,
      });
    },
    'secrets',
    pluginId,
  );
}

function parseWorkers(
  parsed: JsonObject,
  pluginId: string,
): readonly PluginWorkerDeclaration[] {
  const values = parsed.workers === undefined
    ? []
    : requiredArray(parsed, 'workers', 4, pluginId);
  const seen = new Set<string>();
  return Object.freeze(values.map((value, index) => {
    if (!isObject(value)) malformed(`workers[${index}] must be an object`, pluginId);
    assertExactKeys(
      value,
      new Set(['path', 'sha256']),
      `workers[${index}]`,
      pluginId,
    );
    const path = requiredString(value, 'path', 240, pluginId);
    if (
      !/^\.\/workers\/(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/)*[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.mjs$/u.test(path) ||
      seen.has(path)
    ) {
      malformed(`workers[${index}].path must be a unique portable ./workers/*.mjs path`, pluginId);
    }
    seen.add(path);
    const sha256 = requiredString(value, 'sha256', 64, pluginId);
    if (!SHA256.test(sha256)) {
      malformed(`workers[${index}].sha256 must be a lowercase SHA-256 digest`, pluginId);
    }
    return Object.freeze({ path, sha256 });
  }));
}

function decodeManifestSource(source: string | Uint8Array): string {
  const byteLength =
    typeof source === 'string'
      ? Buffer.byteLength(source, 'utf8')
      : source.byteLength;
  if (byteLength > MAX_PLUGIN_MANIFEST_BYTES) {
    throw validationError(
      'unsupported',
      'MANIFEST_TOO_LARGE',
      `plugin.json exceeds the ${MAX_PLUGIN_MANIFEST_BYTES}-byte manifest limit`,
    );
  }
  if (typeof source === 'string') return source;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch (cause) {
    throw validationError(
      'malformed',
      'MANIFEST_INVALID_UTF8',
      'plugin.json is not valid UTF-8',
      { cause },
    );
  }
}

/**
 * Parses and compatibility-gates schema-1 `plugin.json` without touching code.
 */
export function parsePluginManifest(
  source: string | Uint8Array,
  context: PluginCompatibilityContext,
): PluginManifest {
  const appVersion = hostStableVersion(context.appVersion, 'host appVersion');
  const minimumSdk = hostStableVersion(
    context.minSdkVersion,
    'host minSdkVersion',
  );
  const maximumSdk = hostStableVersion(
    context.maxSdkVersion,
    'host maxSdkVersion',
  );
  if (compareVersions(minimumSdk, maximumSdk) > 0) {
    throw new TypeError('host minSdkVersion must not exceed maxSdkVersion');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeManifestSource(source));
  } catch (error) {
    if (isValidationError(error)) throw error;
    throw validationError(
      'malformed',
      'MANIFEST_INVALID_JSON',
      'plugin.json is not valid JSON',
      { cause: error },
    );
  }
  if (!isObject(parsed)) {
    throw validationError(
      'malformed',
      'MANIFEST_INVALID_SHAPE',
      'plugin.json must contain an object',
    );
  }

  if (!Object.hasOwn(parsed, 'schemaVersion')) {
    malformed('schemaVersion is required');
  }
  if (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) {
    throw validationError(
      'unsupported',
      'MANIFEST_SCHEMA_UNSUPPORTED',
      `Plugin manifest schema ${String(parsed.schemaVersion)} is not supported`,
    );
  }

  assertExactKeys(
    parsed,
    parsed.schemaVersion === 1 ? V1_MANIFEST_KEYS : V2_MANIFEST_KEYS,
    'plugin.json',
  );

  const id = requiredString(parsed, 'id', 128);
  if (!ID.test(id)) {
    malformed('id must be a lowercase namespaced identifier', id);
  }
  const name = requiredString(parsed, 'name', 100, id);
  const description = requiredString(parsed, 'description', 1_000, id);
  const version = semver(
    requiredString(parsed, 'version', 64, id),
    'version',
    id,
  );
  const entry = requiredString(parsed, 'entry', 64, id);
  if (entry !== PLUGIN_ENTRY_FILE) {
    throw validationError(
      'malformed',
      'ENTRY_PATH_INVALID',
      `entry must be exactly ${JSON.stringify(PLUGIN_ENTRY_FILE)}`,
      { pluginId: id },
    );
  }

  const sdkVersion = requiredString(parsed, 'sdkVersion', 64, id);
  const pluginSdk = stableVersion(sdkVersion, 'sdkVersion', id);
  if (
    compareVersions(pluginSdk, minimumSdk) < 0 ||
    compareVersions(pluginSdk, maximumSdk) > 0
  ) {
    throw validationError(
      'incompatible',
      'SDK_INCOMPATIBLE',
      `Plugin ${JSON.stringify(id)} uses SDK ${sdkVersion}; host supports >=${context.minSdkVersion} <=${context.maxSdkVersion}`,
      { pluginId: id },
    );
  }

  const minAppVersion = requiredString(parsed, 'minAppVersion', 64, id);
  const minimum = stableVersion(minAppVersion, 'minAppVersion', id);
  const legacyMaxAppVersion = optionalString(parsed, 'maxAppVersion', 64, id);
  if (legacyMaxAppVersion !== undefined) {
    stableVersion(legacyMaxAppVersion, 'maxAppVersion', id);
  }
  if (compareVersions(appVersion, minimum) < 0) {
    throw validationError(
      'incompatible',
      'APP_INCOMPATIBLE',
      `Plugin ${JSON.stringify(id)} is incompatible with app ${context.appVersion} (requires >=${minAppVersion})`,
      { pluginId: id },
    );
  }

  const entrySha256 = requiredString(parsed, 'entrySha256', 64, id);
  if (!SHA256.test(entrySha256)) {
    malformed(
      'entrySha256 must be a lowercase SHA-256 hex digest',
      id,
    );
  }

  const author = optionalString(parsed, 'author', 120, id);
  const homepage = metadataUrl(parsed, 'homepage', id);
  const sourceRepository = metadataUrl(parsed, 'source', id);
  const common = {
    id,
    name,
    description,
    version,
    entry: PLUGIN_ENTRY_FILE,
    sdkVersion,
    minAppVersion,
    entrySha256,
    ...(author === undefined ? {} : { author }),
    ...(homepage === undefined ? {} : { homepage }),
    ...(sourceRepository === undefined ? {} : { source: sourceRepository }),
  } as const;

  if (parsed.schemaVersion === 1) {
    if (
      !Array.isArray(parsed.capabilities) ||
      parsed.capabilities.length !== 1 ||
      parsed.capabilities[0] !== 'node-kinds'
    ) {
      throw validationError(
        'unsupported',
        'CAPABILITY_UNSUPPORTED',
        'Schema 1 supports exactly the "node-kinds" capability',
        { pluginId: id },
      );
    }
    return Object.freeze({
      schemaVersion: 1,
      ...common,
      capabilities: Object.freeze(['node-kinds'] as const),
    }) satisfies PluginManifestV1;
  }

  const capabilities = canonicalStringSubset(
    parsed.capabilities,
    PLUGIN_CAPABILITIES,
    'capabilities',
    id,
  );
  const network = parseNetwork(parsed, id);
  const remoteMedia = parseRemoteMedia(parsed, id);
  const settings = parseSettings(parsed, id);
  const secrets = parseSecrets(parsed, id);
  const workers = parseWorkers(parsed, id);
  const capabilitySet = new Set(capabilities);
  const declarationRequirements = [
    ['network', network.length],
    ['remote-media', remoteMedia.length],
    ['configuration', settings.length],
    ['secrets', secrets.length],
  ] as const;
  for (const [capability, count] of declarationRequirements) {
    if (count > 0 && !capabilitySet.has(capability)) {
      malformed(
        `${capability} declarations require the ${JSON.stringify(capability)} capability`,
        id,
      );
    }
  }
  const declaredSecretNames = new Set(secrets.map(({ name }) => name));
  for (const setting of settings) {
    if (
      setting.type === 'secret-ref' &&
      !declaredSecretNames.has(setting.secret)
    ) {
      malformed(
        `setting ${JSON.stringify(setting.key)} references undeclared secret ${JSON.stringify(setting.secret)}`,
        id,
      );
    }
  }

  return Object.freeze({
    schemaVersion: 2,
    ...common,
    capabilities,
    network,
    remoteMedia,
    settings,
    secrets,
    workers,
  }) satisfies PluginManifestV2;
}
