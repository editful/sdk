import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PluginArtifactValidationError,
  parsePluginManifest,
} from './index.js';

const CONTEXT = {
  appVersion: '0.6.0',
  minSdkVersion: '0.5.0',
  maxSdkVersion: '0.6.0',
} as const;

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    id: 'fixture:remote-photo',
    name: 'Remote photo',
    description: 'Schema 2 fixture',
    version: '0.1.0',
    entry: 'plugin.mjs',
    sdkVersion: '0.6.0',
    minAppVersion: '0.6.0',
    capabilities: [
      'node-kinds',
      'commands',
      'editor-ui',
      'network',
      'configuration',
      'secrets',
      'remote-media',
      'interaction-regions',
    ],
    network: [{
      origin: 'https://api.example.com',
      methods: ['GET', 'POST'],
      purpose: 'Search for photos',
    }],
    remoteMedia: [{
      origin: 'https://images.example.com',
      mediaTypes: ['image/jpeg', 'image/webp'],
      purpose: 'Display selected photos',
    }],
    settings: [
      {
        key: 'result-count',
        label: 'Result count',
        description: 'Maximum results to display',
        type: 'number',
        default: 10,
      },
      {
        key: 'access-key',
        label: 'Access key',
        description: 'Credential reference',
        type: 'secret-ref',
        secret: 'api-key',
      },
    ],
    secrets: [{
      name: 'api-key',
      label: 'API key',
      description: 'Remote service credential',
      required: true,
    }],
    entrySha256: createHash('sha256').update('fixture').digest('hex'),
    ...overrides,
  };
}

function parse(overrides: Record<string, unknown> = {}) {
  return parsePluginManifest(JSON.stringify(manifest(overrides)), CONTEXT);
}

describe('plugin manifest schema 2', () => {
  it('copies and recursively freezes canonical declarations', () => {
    const parsed = parse();
    expect(parsed.schemaVersion).toBe(2);
    if (parsed.schemaVersion !== 2) throw new Error('expected schema 2');

    expect(parsed.capabilities).toEqual(manifest().capabilities);
    expect(parsed.network[0]).toEqual({
      origin: 'https://api.example.com',
      methods: ['GET', 'POST'],
      purpose: 'Search for photos',
    });
    expect(parsed.settings[1]).toMatchObject({
      type: 'secret-ref',
      secret: 'api-key',
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.capabilities)).toBe(true);
    expect(Object.isFrozen(parsed.network)).toBe(true);
    expect(Object.isFrozen(parsed.network[0])).toBe(true);
    expect(Object.isFrozen(parsed.network[0]!.methods)).toBe(true);
    expect(Object.isFrozen(parsed.remoteMedia[0]!.mediaTypes)).toBe(true);
    expect(Object.isFrozen(parsed.settings[0])).toBe(true);
    expect(Object.isFrozen(parsed.secrets[0])).toBe(true);
  });

  it('accepts an action-only plugin with no node kind', () => {
    const parsed = parse({
      capabilities: ['commands'],
      network: [],
      remoteMedia: [],
      settings: [],
      secrets: [],
    });
    expect(parsed.capabilities).toEqual(['commands']);
  });

  it('preserves author-declared enum setting order while rejecting duplicates', () => {
    const declaration = {
      key: 'size',
      label: 'Size',
      description: 'Preferred result size',
      type: 'enum',
      values: ['small', 'medium', 'large'],
      default: 'medium',
    };
    const parsed = parse({
      settings: [declaration],
    });
    if (parsed.schemaVersion !== 2) throw new Error('expected schema 2');
    expect(parsed.settings[0]).toMatchObject({
      type: 'enum',
      values: ['small', 'medium', 'large'],
    });
    expect(() =>
      parse({
        settings: [{
          ...declaration,
          values: ['small', 'small'],
        }],
      }),
    ).toThrow(/unique values/);
  });

  it.each([
    ['noncanonical capability order', { capabilities: ['commands', 'node-kinds'] }],
    ['duplicate capability', { capabilities: ['node-kinds', 'node-kinds'] }],
    [
      'origin path',
      {
        network: [{
          origin: 'https://api.example.com/v1',
          methods: ['GET'],
          purpose: 'Invalid origin',
        }],
      },
    ],
    [
      'origin wildcard',
      {
        network: [{
          origin: 'https://*.example.com',
          methods: ['GET'],
          purpose: 'Invalid origin',
        }],
      },
    ],
    [
      'noncanonical methods',
      {
        network: [{
          origin: 'https://api.example.com',
          methods: ['POST', 'GET'],
          purpose: 'Invalid methods',
        }],
      },
    ],
    [
      'undeclared network capability',
      {
        capabilities: ['node-kinds'],
      },
    ],
    [
      'undeclared secret reference',
      {
        secrets: [],
      },
    ],
    [
      'unknown nested key',
      {
        remoteMedia: [{
          origin: 'https://images.example.com',
          mediaTypes: ['image/jpeg'],
          purpose: 'Photos',
          wildcard: true,
        }],
      },
    ],
  ])('rejects %s', (_label, overrides) => {
    expect(() => parse(overrides)).toThrow(PluginArtifactValidationError);
  });

  it('keeps schema 1 behavior exact', () => {
    const parsed = parsePluginManifest(JSON.stringify({
      ...manifest(),
      schemaVersion: 1,
      capabilities: ['node-kinds'],
      network: undefined,
      remoteMedia: undefined,
      settings: undefined,
      secrets: undefined,
    }), CONTEXT);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.capabilities).toEqual(['node-kinds']);
  });
});
