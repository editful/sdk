import type { PluginArtifactDiagnostic } from './diagnostics.js';

export const PLUGIN_MANIFEST_SCHEMA_VERSION = 2;
export const SUPPORTED_PLUGIN_MANIFEST_SCHEMA_VERSIONS = Object.freeze([
  1,
  2,
] as const);
export const PLUGIN_MANIFEST_FILE = 'plugin.json';
export const PLUGIN_ENTRY_FILE = 'plugin.mjs';
export const MAX_PLUGIN_MANIFEST_BYTES = 64 * 1024;
export const MAX_PLUGIN_BUNDLE_BYTES = 8 * 1024 * 1024;
export const MAX_PLUGIN_ICON_BYTES = 64 * 1024;
export const MAX_PLUGIN_ICON_COUNT = 16;
export const MAX_PLUGIN_ICON_TOTAL_BYTES = 256 * 1024;

export const PLUGIN_CAPABILITIES = Object.freeze([
  'node-kinds',
  'commands',
  'editor-ui',
  'importers',
  'network',
  'configuration',
  'secrets',
  'remote-media',
  'interaction-regions',
  'agent-actions',
] as const);

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];
export type PluginNetworkMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE';

export interface PluginNetworkDeclaration {
  readonly origin: string;
  readonly methods: readonly PluginNetworkMethod[];
  readonly purpose: string;
}

export type PluginRemoteMediaType =
  | 'image/avif'
  | 'image/gif'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp';

export interface PluginRemoteMediaDeclaration {
  readonly origin: string;
  readonly mediaTypes: readonly PluginRemoteMediaType[];
  readonly purpose: string;
}

interface PluginSettingDeclarationBase {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}

export type PluginSettingDeclaration =
  | (PluginSettingDeclarationBase & {
      readonly type: 'string';
      readonly default?: string;
    })
  | (PluginSettingDeclarationBase & {
      readonly type: 'number';
      readonly default?: number;
    })
  | (PluginSettingDeclarationBase & {
      readonly type: 'boolean';
      readonly default?: boolean;
    })
  | (PluginSettingDeclarationBase & {
      readonly type: 'enum';
      readonly values: readonly string[];
      readonly default?: string;
    })
  | (PluginSettingDeclarationBase & {
      readonly type: 'secret-ref';
      readonly secret: string;
    });

export interface PluginSecretDeclaration {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly required: boolean;
}

interface PluginManifestBase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly entry: 'plugin.mjs';
  readonly sdkVersion: string;
  readonly minAppVersion: string;
  readonly maxAppVersion: string;
  readonly entrySha256: string;
  readonly author?: string;
  readonly homepage?: string;
  readonly source?: string;
}

export interface PluginManifestV1 extends PluginManifestBase {
  readonly schemaVersion: 1;
  readonly capabilities: readonly ['node-kinds'];
}

export interface PluginManifestV2 extends PluginManifestBase {
  readonly schemaVersion: 2;
  readonly capabilities: readonly PluginCapability[];
  readonly network: readonly PluginNetworkDeclaration[];
  readonly remoteMedia: readonly PluginRemoteMediaDeclaration[];
  readonly settings: readonly PluginSettingDeclaration[];
  readonly secrets: readonly PluginSecretDeclaration[];
}

export type PluginManifest = PluginManifestV1 | PluginManifestV2;

export interface PluginCompatibilityContext {
  /** Stable host application SemVer. */
  readonly appVersion: string;
  /** Exact public SDK package/contract version accepted by this host. */
  readonly sdkVersion: string;
}

/**
 * Immutable content retained after validation.
 *
 * `readBytes` returns a copy so callers cannot mutate what a later protocol
 * response serves. No API exposes a source path that should be read again.
 */
export interface ValidatedPluginModule {
  readonly digest: string;
  readonly byteLength: number;
  readonly source: string;
  readBytes(): Uint8Array;
}

/** Immutable, validated SVG toolbar asset bundled beside the plugin entry. */
export interface ValidatedPluginIcon {
  /** Explicit plugin-relative path, for example `./icons/search.svg`. */
  readonly path: string;
  readonly digest: string;
  readonly source: string;
  readonly byteLength: number;
}

export interface ValidatedPluginArtifact {
  /** Canonical path used only for diagnostics and discovery identity. */
  readonly directory: string;
  /** SHA-256 of the exact bounded plugin.json bytes accepted by validation. */
  readonly manifestDigest: string;
  readonly manifest: PluginManifest;
  readonly module: ValidatedPluginModule;
  readonly icons: readonly ValidatedPluginIcon[];
}

export interface PluginArtifactValidationOptions
  extends PluginCompatibilityContext {
  /** Optional shared content-addressed retention for the future protocol. */
  readonly cache?: PluginArtifactCacheLike;
}

export interface PluginArtifactCacheLike {
  retain(module: ValidatedPluginModule): ValidatedPluginModule;
}

export type PluginArtifactValidationResult =
  | {
      readonly ok: true;
      readonly value: ValidatedPluginArtifact;
    }
  | {
      readonly ok: false;
      readonly diagnostic: PluginArtifactDiagnostic;
    };
