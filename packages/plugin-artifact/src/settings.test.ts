import { describe, expect, it } from 'vitest';
import { parsePluginManifest } from './manifest.js';
import { validatePluginSettings } from './settings.js';

function manifest(settings: unknown[]) {
  return parsePluginManifest(JSON.stringify({
    schemaVersion: 2,
    id: 'fixture:profile',
    name: 'Profile fixture',
    description: 'Fixture',
    version: '1.0.0',
    entry: 'plugin.mjs',
    sdkVersion: '0.6.0',
    minAppVersion: '0.6.0',
    entrySha256: 'a'.repeat(64),
    capabilities: ['configuration', 'secrets'],
    network: [],
    remoteMedia: [],
    settings,
    secrets: [{
      name: 'api-key',
      label: 'API key',
      description: 'Key',
      required: true,
    }],
  }), {
    appVersion: '0.6.0',
    minSdkVersion: '0.5.0',
    maxSdkVersion: '0.6.0',
  });
}

describe('validatePluginSettings', () => {
  it('applies defaults and retains only values matching the current schema', () => {
    const schema = manifest([
      {
        key: 'mode',
        label: 'Mode',
        description: 'Mode',
        type: 'enum',
        values: ['fast', 'safe'],
        default: 'safe',
      },
      {
        key: 'limit',
        label: 'Limit',
        description: 'Limit',
        type: 'number',
        default: 10,
      },
      {
        key: 'account',
        label: 'Account',
        description: 'Account',
        type: 'secret-ref',
        secret: 'api-key',
      },
    ]);

    const result = validatePluginSettings(schema, {
      mode: 'fast',
      limit: Number.NaN,
      account: 'Unsplash production',
      removed: 'old',
    });

    expect(result.values).toEqual({
      mode: 'fast',
      limit: 10,
      account: 'Unsplash production',
    });
    expect(result.invalidKeys).toEqual(['limit']);
    expect(result.removedKeys).toEqual(['removed']);
    expect(Object.isFrozen(result.values)).toBe(true);
  });

  it('does not carry an old value across an incompatible schema change', () => {
    const schema = manifest([{
      key: 'limit',
      label: 'Limit',
      description: 'Limit',
      type: 'boolean',
      default: false,
    }]);
    expect(validatePluginSettings(schema, { limit: 12 })).toEqual({
      values: { limit: false },
      invalidKeys: ['limit'],
      removedKeys: [],
    });
  });

  it('returns no profile values for schema 1', () => {
    const schema = parsePluginManifest(JSON.stringify({
      schemaVersion: 1,
      id: 'fixture:legacy',
      name: 'Legacy',
      description: 'Legacy',
      version: '1.0.0',
      entry: 'plugin.mjs',
      sdkVersion: '0.6.0',
      minAppVersion: '0.6.0',
      entrySha256: 'b'.repeat(64),
      capabilities: ['node-kinds'],
    }), {
      appVersion: '0.6.0',
      minSdkVersion: '0.5.0',
      maxSdkVersion: '0.6.0',
    });
    expect(validatePluginSettings(schema, { old: true })).toEqual({
      values: {},
      invalidKeys: [],
      removedKeys: ['old'],
    });
  });
});
