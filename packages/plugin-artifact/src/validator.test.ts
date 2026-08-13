import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_PLUGIN_BUNDLE_BYTES,
  MAX_PLUGIN_MANIFEST_BYTES,
  PluginArtifactCache,
  PluginArtifactValidationError,
  parsePluginManifest,
  validatePluginArtifact,
  validatePluginArtifactResult,
  type PluginArtifactDiagnosticCategory,
  type PluginArtifactDiagnosticCode,
} from './index.js';

const CONTEXT = {
  appVersion: '0.6.0',
  minSdkVersion: '0.5.0',
  maxSdkVersion: '0.6.0',
} as const;
const VALID_SOURCE = 'export default { register() {} };\n';

function digest(source: string | Uint8Array): string {
  return createHash('sha256').update(source).digest('hex');
}

function manifest(
  source: string | Uint8Array = VALID_SOURCE,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'fixture:status-card',
    name: 'Status Card',
    description: 'Contract fixture',
    version: '0.1.0',
    entry: 'plugin.mjs',
    sdkVersion: '0.6.0',
    minAppVersion: '0.6.0',
    capabilities: ['node-kinds'],
    entrySha256: digest(source),
    ...overrides,
  };
}

interface TemporaryArtifact {
  root: string;
  directory: string;
  dispose(): Promise<void>;
}

async function temporaryArtifact(
  source: string | Uint8Array = VALID_SOURCE,
  overrides: Record<string, unknown> = {},
  extras: readonly string[] = [],
): Promise<TemporaryArtifact> {
  const root = await mkdtemp(join(tmpdir(), 'editful-plugin-artifact-'));
  const directory = join(root, 'plugin');
  await mkdir(directory);
  await writeFile(join(directory, 'plugin.mjs'), source);
  await writeFile(
    join(directory, 'plugin.json'),
    `${JSON.stringify(manifest(source, overrides), null, 2)}\n`,
  );
  for (const extra of extras) {
    await writeFile(join(directory, extra), '');
  }
  return {
    root,
    directory,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

async function expectDiagnostic(
  promise: Promise<unknown>,
  code: PluginArtifactDiagnosticCode,
  category: PluginArtifactDiagnosticCategory,
): Promise<PluginArtifactValidationError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PluginArtifactValidationError);
    const validation = error as PluginArtifactValidationError;
    expect(validation.diagnostic).toMatchObject({ code, category });
    return validation;
  }
  throw new Error(`Expected ${code}`);
}

describe('plugin manifest schema 1', () => {
  it('parses the approved manifest and optional display metadata', () => {
    const parsed = parsePluginManifest(
      JSON.stringify(
        manifest(VALID_SOURCE, {
          author: 'Fixture Team',
          homepage: 'https://example.com/plugin',
          source: 'https://github.com/example/plugin',
          version: '1.2.3-beta.1+build.7',
        }),
      ),
      CONTEXT,
    );

    expect(parsed).toMatchObject({
      schemaVersion: 1,
      id: 'fixture:status-card',
      entry: 'plugin.mjs',
      capabilities: ['node-kinds'],
      author: 'Fixture Team',
      homepage: 'https://example.com/plugin',
      source: 'https://github.com/example/plugin',
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.capabilities)).toBe(true);
  });

  it.each([
    {
      name: 'invalid JSON',
      source: '{',
      code: 'MANIFEST_INVALID_JSON',
      category: 'malformed',
    },
    {
      name: 'non-object JSON',
      source: '[]',
      code: 'MANIFEST_INVALID_SHAPE',
      category: 'malformed',
    },
    {
      name: 'unknown key',
      overrides: { surprise: true },
      code: 'MANIFEST_KEY_UNSUPPORTED',
      category: 'unsupported',
    },
    {
      name: 'future schema',
      overrides: { schemaVersion: 3 },
      code: 'MANIFEST_SCHEMA_UNSUPPORTED',
      category: 'unsupported',
    },
    {
      name: 'unscoped id',
      overrides: { id: 'status-card' },
      code: 'MANIFEST_FIELD_INVALID',
      category: 'malformed',
    },
    {
      name: 'invalid plugin SemVer',
      overrides: { version: 'v1' },
      code: 'MANIFEST_FIELD_INVALID',
      category: 'malformed',
    },
    {
      name: 'invalid digest',
      overrides: { entrySha256: 'ABC' },
      code: 'MANIFEST_FIELD_INVALID',
      category: 'malformed',
    },
    {
      name: 'path traversal entry',
      overrides: { entry: '../plugin.mjs' },
      code: 'ENTRY_PATH_INVALID',
      category: 'malformed',
    },
    {
      name: 'unsupported capability',
      overrides: { capabilities: ['node-kinds', 'network'] },
      code: 'CAPABILITY_UNSUPPORTED',
      category: 'unsupported',
    },
    {
      name: 'bad metadata URL',
      overrides: { homepage: 'file:///tmp/plugin' },
      code: 'MANIFEST_FIELD_INVALID',
      category: 'malformed',
    },
  ] as const)('classifies $name', async (fixture) => {
    const source =
      'source' in fixture
        ? fixture.source
        : JSON.stringify(manifest(VALID_SOURCE, fixture.overrides));
    await expectDiagnostic(
      Promise.resolve().then(() => parsePluginManifest(source, CONTEXT)),
      fixture.code,
      fixture.category,
    );
  });

  it('gates the lower-inclusive app requirement without a future ceiling', async () => {
    const source = JSON.stringify(manifest());
    expect(
      parsePluginManifest(source, {
        ...CONTEXT,
        appVersion: '0.6.0',
      }).id,
    ).toBe('fixture:status-card');
    expect(
      parsePluginManifest(source, {
        ...CONTEXT,
        appVersion: '9.0.0',
      }).id,
    ).toBe('fixture:status-card');
    await expectDiagnostic(
      Promise.resolve().then(() =>
        parsePluginManifest(source, {
          ...CONTEXT,
          appVersion: '0.5.9',
        }),
      ),
      'APP_INCOMPATIBLE',
      'incompatible',
    );
  });

  it('reports an unsupported schema before inspecting its unknown keys', async () => {
    await expectDiagnostic(
      Promise.resolve().then(() =>
        parsePluginManifest(
          JSON.stringify(manifest(VALID_SOURCE, {
            schemaVersion: 3,
            surprise: true,
          })),
          CONTEXT,
        ),
      ),
      'MANIFEST_SCHEMA_UNSUPPORTED',
      'unsupported',
    );
  });

  it('stores the canonical URL that was actually validated', () => {
    const parsed = parsePluginManifest(
      JSON.stringify(manifest(VALID_SOURCE, {
        homepage: 'ht\ntps://example.com/x',
        source: 'https://example.com/a\rb',
      })),
      CONTEXT,
    );

    expect(parsed.homepage).toBe('https://example.com/x');
    expect(parsed.source).toBe('https://example.com/ab');
  });

  it('accepts SDK versions inside the inclusive host-owned range', async () => {
    expect(
      parsePluginManifest(
        JSON.stringify(manifest(VALID_SOURCE, { sdkVersion: '0.5.0' })),
        CONTEXT,
      ).sdkVersion,
    ).toBe('0.5.0');
    expect(
      parsePluginManifest(
        JSON.stringify(manifest(VALID_SOURCE, { sdkVersion: '0.6.0' })),
        CONTEXT,
      ).sdkVersion,
    ).toBe('0.6.0');
  });

  it.each(['0.4.9', '0.6.1'])('rejects SDK %s outside the host range', async (sdkVersion) => {
    await expectDiagnostic(
      Promise.resolve().then(() =>
        parsePluginManifest(
          JSON.stringify(manifest(VALID_SOURCE, { sdkVersion })),
          CONTEXT,
        ),
      ),
      'SDK_INCOMPATIBLE',
      'incompatible',
    );
  });

  it('accepts and ignores a legacy maxAppVersion ceiling', () => {
    const parsed = parsePluginManifest(
      JSON.stringify(manifest(VALID_SOURCE, { maxAppVersion: '0.7.0' })),
      { ...CONTEXT, appVersion: '9.0.0' },
    );
    expect(parsed).not.toHaveProperty('maxAppVersion');
  });

  it('rejects invalid UTF-8 and the byte limit before JSON parsing', async () => {
    await expectDiagnostic(
      Promise.resolve().then(() =>
        parsePluginManifest(new Uint8Array([0xff]), CONTEXT),
      ),
      'MANIFEST_INVALID_UTF8',
      'malformed',
    );
    await expectDiagnostic(
      Promise.resolve().then(() =>
        parsePluginManifest(
          new Uint8Array(MAX_PLUGIN_MANIFEST_BYTES + 1),
          CONTEXT,
        ),
      ),
      'MANIFEST_TOO_LARGE',
      'unsupported',
    );
  });
});

describe('validated plugin workers', () => {
  it('retains declared worker bytes by digest', async () => {
    const workerSource = 'self.onmessage = () => undefined; export default {};\n';
    const artifact = await temporaryArtifact(VALID_SOURCE, {
      schemaVersion: 2,
      capabilities: ['gpu-renderer'],
      network: [],
      remoteMedia: [],
      settings: [],
      secrets: [],
      workers: [{
        path: './workers/render.mjs',
        sha256: digest(workerSource),
      }],
    });
    await mkdir(join(artifact.directory, 'workers'));
    await writeFile(join(artifact.directory, 'workers/render.mjs'), workerSource);
    try {
      const validated = await validatePluginArtifact(artifact.directory, CONTEXT);
      expect(validated.workers).toHaveLength(1);
      expect(validated.workers[0]).toMatchObject({
        path: './workers/render.mjs',
        module: { digest: digest(workerSource) },
      });
    } finally {
      await artifact.dispose();
    }
  });
});

describe('plugin artifact filesystem validation', () => {
  it('retains the exact validated bytes after the source path changes', async () => {
    const artifact = await temporaryArtifact();
    try {
      const originalManifest = await readFile(
        join(artifact.directory, 'plugin.json'),
      );
      const validated = await validatePluginArtifact(
        artifact.directory,
        CONTEXT,
      );
      await writeFile(
        join(artifact.directory, 'plugin.mjs'),
        "throw new Error('changed after validation');",
      );

      expect(validated.module.source).toBe(VALID_SOURCE);
      expect(validated.manifestDigest).toBe(digest(originalManifest));
      expect(
        new TextDecoder().decode(validated.module.readBytes()),
      ).toBe(VALID_SOURCE);
      expect(validated.module.digest).toBe(digest(VALID_SOURCE));
    } finally {
      await artifact.dispose();
    }
  });

  it('retains canonical immutable content by digest in a shared cache', async () => {
    const first = await temporaryArtifact();
    const second = await temporaryArtifact(VALID_SOURCE, {
      id: 'fixture:second-card',
    });
    const cache = new PluginArtifactCache();
    try {
      const a = await validatePluginArtifact(first.directory, {
        ...CONTEXT,
        cache,
      });
      const b = await validatePluginArtifact(second.directory, {
        ...CONTEXT,
        cache,
      });
      expect(cache.size).toBe(1);
      expect(a.module).toBe(b.module);

      const callerCopy = a.module.readBytes();
      callerCopy[0] = 0;
      expect(new TextDecoder().decode(a.module.readBytes())).toBe(VALID_SOURCE);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it('does not execute a compatible module during validation', async () => {
    delete (globalThis as { __PLUGIN_VALIDATOR_EXECUTED__?: boolean })
      .__PLUGIN_VALIDATOR_EXECUTED__;
    const source =
      'globalThis.__PLUGIN_VALIDATOR_EXECUTED__ = true; export default {};\n';
    const artifact = await temporaryArtifact(source);
    try {
      await validatePluginArtifact(artifact.directory, CONTEXT);
      expect(
        (globalThis as { __PLUGIN_VALIDATOR_EXECUTED__?: boolean })
          .__PLUGIN_VALIDATOR_EXECUTED__,
      ).toBeUndefined();
    } finally {
      await artifact.dispose();
    }
  });

  it('reports incompatibility before inspecting invalid module syntax', async () => {
    const artifact = await temporaryArtifact('export default {', {
      minAppVersion: '0.7.0',
    });
    try {
      await expectDiagnostic(
        validatePluginArtifact(artifact.directory, CONTEXT),
        'APP_INCOMPATIBLE',
        'incompatible',
      );
    } finally {
      await artifact.dispose();
    }
  });

  it('returns a result-shaped structured diagnostic', async () => {
    const result = await validatePluginArtifactResult(
      join(tmpdir(), 'editful-plugin-does-not-exist'),
      CONTEXT,
    );
    expect(result).toEqual({
      ok: false,
      diagnostic: expect.objectContaining({
        category: 'missing',
        code: 'ARTIFACT_NOT_FOUND',
      }),
    });
  });

  it('rejects a missing artifact directory', async () => {
    await expectDiagnostic(
      validatePluginArtifact(
        join(tmpdir(), 'editful-plugin-does-not-exist'),
        CONTEXT,
      ),
      'ARTIFACT_NOT_FOUND',
      'missing',
    );
  });

  it('rejects an artifact path that is not a directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'editful-plugin-artifact-file-'));
    const path = join(root, 'plugin.mjs');
    try {
      await writeFile(path, VALID_SOURCE);
      await expectDiagnostic(
        validatePluginArtifact(path, CONTEXT),
        'ARTIFACT_NOT_DIRECTORY',
        'malformed',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['plugin.json', 'MANIFEST_MISSING', 'missing'],
    ['plugin.mjs', 'ENTRY_MISSING', 'missing'],
  ] as const)('rejects missing %s', async (name, code, category) => {
    const artifact = await temporaryArtifact();
    try {
      await rm(join(artifact.directory, name));
      await expectDiagnostic(
        validatePluginArtifact(artifact.directory, CONTEXT),
        code,
        category,
      );
    } finally {
      await artifact.dispose();
    }
  });

  it('rejects extra files and auxiliary chunks', async () => {
    const artifact = await temporaryArtifact(
      VALID_SOURCE,
      {},
      ['chunk-2.mjs'],
    );
    try {
      await expectDiagnostic(
        validatePluginArtifact(artifact.directory, CONTEXT),
        'ARTIFACT_FILES_UNSUPPORTED',
        'unsupported',
      );
    } finally {
      await artifact.dispose();
    }
  });

  it('retains bounded passive SVG icons by plugin-relative path', async () => {
    const artifact = await temporaryArtifact();
    try {
      await mkdir(join(artifact.directory, 'icons'));
      await writeFile(
        join(artifact.directory, 'icons', 'search.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2 2h16v16H2z"/></svg>',
      );
      const validated = await validatePluginArtifact(
        artifact.directory,
        CONTEXT,
      );
      expect(validated.icons).toEqual([
        expect.objectContaining({
          path: './icons/search.svg',
          byteLength: expect.any(Number),
          digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]);
      expect(Object.isFrozen(validated.icons)).toBe(true);
    } finally {
      await artifact.dispose();
    }
  });

  it('rejects active or externally-referencing SVG content', async () => {
    const artifact = await temporaryArtifact();
    try {
      await writeFile(
        join(artifact.directory, 'unsafe.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );
      await expectDiagnostic(
        validatePluginArtifact(artifact.directory, CONTEXT),
        'ICON_SVG_INVALID',
        'unsupported',
      );
    } finally {
      await artifact.dispose();
    }
  });

  it('rejects an escaping entry symlink', async () => {
    const artifact = await temporaryArtifact();
    const outside = join(artifact.root, 'outside.mjs');
    try {
      await writeFile(outside, VALID_SOURCE);
      await rm(join(artifact.directory, 'plugin.mjs'));
      await symlink(outside, join(artifact.directory, 'plugin.mjs'));
      await expectDiagnostic(
        validatePluginArtifact(artifact.directory, CONTEXT),
        'ENTRY_ESCAPES_ARTIFACT',
        'corrupt',
      );
    } finally {
      await artifact.dispose();
    }
  });

  it('rejects non-regular manifest and entry paths', async () => {
    const manifestArtifact = await temporaryArtifact();
    const entryArtifact = await temporaryArtifact();
    try {
      const manifestOutside = join(manifestArtifact.root, 'manifest.json');
      await writeFile(
        manifestOutside,
        JSON.stringify(manifest()),
      );
      await rm(join(manifestArtifact.directory, 'plugin.json'));
      await symlink(
        manifestOutside,
        join(manifestArtifact.directory, 'plugin.json'),
      );
      await expectDiagnostic(
        validatePluginArtifact(manifestArtifact.directory, CONTEXT),
        'MANIFEST_NOT_REGULAR',
        'corrupt',
      );

      await rm(join(entryArtifact.directory, 'plugin.mjs'));
      await mkdir(join(entryArtifact.directory, 'plugin.mjs'));
      await expectDiagnostic(
        validatePluginArtifact(entryArtifact.directory, CONTEXT),
        'ENTRY_NOT_REGULAR',
        'corrupt',
      );
    } finally {
      await manifestArtifact.dispose();
      await entryArtifact.dispose();
    }
  });

  it('enforces manifest and bundle byte limits', async () => {
    const manifestArtifact = await temporaryArtifact();
    const largeSource =
      `export default {};\n/*${'x'.repeat(MAX_PLUGIN_BUNDLE_BYTES)}*/`;
    const bundleArtifact = await temporaryArtifact(largeSource);
    try {
      await writeFile(
        join(manifestArtifact.directory, 'plugin.json'),
        new Uint8Array(MAX_PLUGIN_MANIFEST_BYTES + 1),
      );
      await expectDiagnostic(
        validatePluginArtifact(manifestArtifact.directory, CONTEXT),
        'MANIFEST_TOO_LARGE',
        'unsupported',
      );
      await expectDiagnostic(
        validatePluginArtifact(bundleArtifact.directory, CONTEXT),
        'ENTRY_TOO_LARGE',
        'unsupported',
      );
    } finally {
      await manifestArtifact.dispose();
      await bundleArtifact.dispose();
    }
  });

  it('rejects digest mismatch and invalid module UTF-8', async () => {
    const digestArtifact = await temporaryArtifact(VALID_SOURCE, {
      entrySha256: '0'.repeat(64),
    });
    const invalidUtf8 = new Uint8Array([0xff]);
    const encodingArtifact = await temporaryArtifact(invalidUtf8);
    try {
      await expectDiagnostic(
        validatePluginArtifact(digestArtifact.directory, CONTEXT),
        'ENTRY_DIGEST_MISMATCH',
        'corrupt',
      );
      await expectDiagnostic(
        validatePluginArtifact(encodingArtifact.directory, CONTEXT),
        'ENTRY_INVALID_UTF8',
        'corrupt',
      );
    } finally {
      await digestArtifact.dispose();
      await encodingArtifact.dispose();
    }
  });
});

describe('single-file ESM validation', () => {
  it.each([
    ["import value from './other.mjs'; export default value;", './other.mjs'],
    ["import './side-effect.mjs'; export default {};", './side-effect.mjs'],
    ["export * from './other.mjs'; export default {};", './other.mjs'],
    ["const value = import('./other.mjs'); export default value;", './other.mjs'],
    ['const value = import(path); export default value;', 'path'],
  ])('rejects runtime imports with the module lexer', async (source) => {
    const artifact = await temporaryArtifact(source);
    try {
      await expectDiagnostic(
        validatePluginArtifact(artifact.directory, CONTEXT),
        'ENTRY_IMPORT_UNSUPPORTED',
        'unsupported',
      );
    } finally {
      await artifact.dispose();
    }
  });

  it('allows import-looking strings, comments, and import.meta', async () => {
    const source = `
      // import "./not-real.mjs";
      const text = "import('./also-not-real.mjs')";
      const ownUrl = import.meta.url;
      export default { text, ownUrl };
    `;
    const artifact = await temporaryArtifact(source);
    try {
      await expect(
        validatePluginArtifact(artifact.directory, CONTEXT),
      ).resolves.toMatchObject({
        manifest: { id: 'fixture:status-card' },
      });
    } finally {
      await artifact.dispose();
    }
  });

  it('rejects invalid syntax and a missing default export', async () => {
    const syntax = await temporaryArtifact('export default {');
    const namedOnly = await temporaryArtifact('export const plugin = {};\n');
    try {
      await expectDiagnostic(
        validatePluginArtifact(syntax.directory, CONTEXT),
        'ENTRY_SYNTAX_INVALID',
        'malformed',
      );
      await expectDiagnostic(
        validatePluginArtifact(namedOnly.directory, CONTEXT),
        'ENTRY_SYNTAX_INVALID',
        'malformed',
      );
    } finally {
      await syntax.dispose();
      await namedOnly.dispose();
    }
  });

  it('allows inline source maps and rejects external source maps', async () => {
    const inline = await temporaryArtifact(
      'export default {};\n//# sourceMappingURL=data:application/json;base64,e30=\n',
    );
    const external = await temporaryArtifact(
      'export default {};\n//# sourceMappingURL=../source/plugin.ts.map\n',
    );
    try {
      await expect(
        validatePluginArtifact(inline.directory, CONTEXT),
      ).resolves.toBeDefined();
      await expectDiagnostic(
        validatePluginArtifact(external.directory, CONTEXT),
        'ENTRY_SOURCE_MAP_UNSUPPORTED',
        'unsupported',
      );
    } finally {
      await inline.dispose();
      await external.dispose();
    }
  });

  it('serves retained content without rereading the filesystem', async () => {
    const artifact = await temporaryArtifact();
    try {
      const validated = await validatePluginArtifact(
        artifact.directory,
        CONTEXT,
      );
      const before = await readFile(join(artifact.directory, 'plugin.mjs'));
      await rm(artifact.directory, { recursive: true, force: true });
      expect(validated.module.readBytes()).toEqual(new Uint8Array(before));
    } finally {
      await artifact.dispose();
    }
  });
});
