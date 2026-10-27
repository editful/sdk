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

  describe('external scripts', () => {
    const scriptCapabilities = [
      'node-kinds',
      'commands',
      'editor-ui',
      'network',
      'configuration',
      'secrets',
      'remote-media',
      'interaction-regions',
      'external-scripts',
    ];
    const scriptNetwork = [
      {
        origin: 'https://api.example.com',
        methods: ['GET', 'POST'],
        purpose: 'Search for photos',
      },
      {
        origin: 'https://scripts.example.com',
        methods: ['GET'],
        purpose: 'Load the map library and its data',
      },
    ];
    function parseScripts(
      scripts: unknown,
      overrides: Record<string, unknown> = {},
    ) {
      return parse({
        capabilities: scriptCapabilities,
        network: scriptNetwork,
        scripts,
        ...overrides,
      });
    }

    it('defaults to no script origins', () => {
      const parsed = parse();
      if (parsed.schemaVersion !== 2) throw new Error('expected schema 2');
      expect(parsed.scripts).toEqual([]);
      expect(Object.isFrozen(parsed.scripts)).toBe(true);
    });

    it('copies and freezes declared script origins', () => {
      const parsed = parseScripts([{
        origin: 'https://scripts.example.com',
        purpose: 'Run the map library',
      }]);
      if (parsed.schemaVersion !== 2) throw new Error('expected schema 2');
      expect(parsed.capabilities.at(-1)).toBe('external-scripts');
      expect(parsed.scripts).toEqual([{
        origin: 'https://scripts.example.com',
        purpose: 'Run the map library',
      }]);
      expect(Object.isFrozen(parsed.scripts)).toBe(true);
      expect(Object.isFrozen(parsed.scripts[0])).toBe(true);
    });

    it.each([
      [
        'a missing external-scripts capability',
        [{ origin: 'https://scripts.example.com', purpose: 'Run code' }],
        { capabilities: manifest().capabilities },
        /require the "external-scripts" capability/,
      ],
      [
        'a non-HTTPS origin',
        [{ origin: 'http://scripts.example.com', purpose: 'Run code' }],
        {},
        /scripts\[0\]\.origin must be a canonical HTTPS origin/,
      ],
      [
        'a wildcard origin',
        [{ origin: 'https://*.example.com', purpose: 'Run code' }],
        {},
        /scripts\[0\]\.origin must be/,
      ],
      [
        'an origin with a path',
        [{ origin: 'https://scripts.example.com/maps/api/js', purpose: 'Run code' }],
        {},
        /scripts\[0\]\.origin must be a canonical HTTPS origin/,
      ],
      [
        'an origin with credentials',
        [{ origin: 'https://user:secret@scripts.example.com', purpose: 'Run code' }],
        {},
        /scripts\[0\]\.origin must be a canonical HTTPS origin/,
      ],
      [
        'a missing purpose',
        [{ origin: 'https://scripts.example.com' }],
        {},
        /purpose must be a non-empty string/,
      ],
      [
        'an overlong purpose',
        [{ origin: 'https://scripts.example.com', purpose: 'x'.repeat(241) }],
        {},
        /purpose exceeds its 240-character limit/,
      ],
      [
        'an unknown nested key',
        [{ origin: 'https://scripts.example.com', purpose: 'Run code', integrity: 'sha384-x' }],
        {},
        /scripts\[0\] contains unsupported key "integrity"/,
      ],
      [
        'a duplicate origin',
        [
          { origin: 'https://scripts.example.com', purpose: 'Run code' },
          { origin: 'https://scripts.example.com', purpose: 'Run more code' },
        ],
        {},
        /duplicate declaration/,
      ],
      [
        'more than four origins',
        ['a', 'b', 'c', 'd', 'e'].map((host) => ({
          origin: `https://${host}.example.com`,
          purpose: 'Run code',
        })),
        {},
        /scripts exceeds its 4-item limit/,
      ],
      [
        'an origin missing from network',
        [{ origin: 'https://images.example.com', purpose: 'Run code' }],
        {},
        /scripts\[0\]\.origin "https:\/\/images\.example\.com" must also be declared in network/,
      ],
    ])('rejects %s', (_label, scripts, overrides, message) => {
      expect(() => parseScripts(scripts, overrides)).toThrow(
        PluginArtifactValidationError,
      );
      expect(() => parseScripts(scripts, overrides)).toThrow(message);
    });

    it('never treats network access as permission to run scripts', () => {
      const parsed = parse({ capabilities: scriptCapabilities });
      if (parsed.schemaVersion !== 2) throw new Error('expected schema 2');
      expect(parsed.network.length).toBeGreaterThan(0);
      expect(parsed.scripts).toEqual([]);
    });

    it('is unavailable to schema 1 manifests', () => {
      expect(() => parsePluginManifest(JSON.stringify({
        ...manifest(),
        schemaVersion: 1,
        capabilities: ['node-kinds'],
        network: undefined,
        remoteMedia: undefined,
        settings: undefined,
        secrets: undefined,
        scripts: [],
      }), CONTEXT)).toThrow(/unsupported key "scripts"/);
    });
  });

  describe.each([
    'https://maps.example.com;sandbox',
    'https://x,script-src',
    'https://x"y',
    "https://x$'y",
    'https://x$&y',
    'https://x_y.example.com',
    'https://-x.example.com',
    'https://example.com.',
  ])('origin %s', (origin) => {
    it.each([
      ['network', { network: [{ origin, methods: ['GET'], purpose: 'Data' }] }],
      [
        'remoteMedia',
        { remoteMedia: [{ origin, mediaTypes: ['image/jpeg'], purpose: 'Images' }] },
      ],
      [
        'scripts',
        {
          capabilities: [...(manifest().capabilities as string[]), 'external-scripts'],
          scripts: [{ origin, purpose: 'Run code' }],
        },
      ],
    ])('is rejected in %s', (key, overrides) => {
      expect(() => parse(overrides)).toThrow(
        new RegExp(`^${key}\\[0\\]\\.origin must be a canonical HTTPS origin with a lowercase DNS hostname`, 'u'),
      );
    });
  });

  it('accepts punycode and numeric DNS labels', () => {
    const parsed = parse({
      network: [{ origin: 'https://xn--bcher-kva.example', methods: ['GET'], purpose: 'Data' }],
      remoteMedia: [{ origin: 'https://cdn1.example-images.com', mediaTypes: ['image/png'], purpose: 'Images' }],
    });
    if (parsed.schemaVersion !== 2) throw new Error('expected schema 2');
    expect(parsed.network[0]!.origin).toBe('https://xn--bcher-kva.example');
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
