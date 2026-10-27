import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPlugin, checkPlugin, packPlugin } from './build.js';

const temporary: string[] = [];
const packageDirectory = resolve(import.meta.dirname, '..');

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function project(
  entry: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const directory = await mkdtemp(join(packageDirectory, '.plugin-tools-test-'));
  temporary.push(directory);
  await writeFile(join(directory, 'index.tsx'), entry);
  await writeFile(
    join(directory, 'editful.plugin.mjs'),
    `export default ${JSON.stringify({
      id: 'fixture:react-editor',
      name: 'React editor',
      description: 'Plugin tools fixture',
      version: '1.2.3',
      entry: './index.tsx',
      minAppVersion: '0.8.0',
      capabilities: ['editor-ui'],
      ...overrides,
    })};\n`,
  );
  return directory;
}

describe('plugin tools build', () => {
  it('bundles React and npm packages into one validated production module', async () => {
    const directory = await project(`
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { definePlugin } from '@editful/canvas-sdk';
      export default definePlugin({
        register(context) {
          context.editor({
            id: 'fixture:editor',
            label: 'Fixture',
            surface: 'right-sidebar',
            mount(container: Element) {
              const root = createRoot(container);
              root.render(React.createElement('button', null, 'Hello'));
              return { dispose() { root.unmount(); } };
            },
          });
        },
      });
    `);

    const result = await buildPlugin({ projectDirectory: directory });
    const source = await readFile(
      join(result.artifactDirectory, 'plugin.mjs'),
      'utf8',
    );
    const manifest = JSON.parse(
      await readFile(join(result.artifactDirectory, 'plugin.json'), 'utf8'),
    ) as { id: string; sdkVersion: string; entrySha256: string; maxAppVersion?: string };

    expect(manifest.id).toBe('fixture:react-editor');
    expect(manifest.sdkVersion).toBe('0.9.0');
    expect(manifest.maxAppVersion).toBeUndefined();
    expect(manifest.entrySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source).not.toMatch(/(?:^|[;\n])\s*import\s/u);
    expect(result.bundleBytes).toBeLessThan(400_000);
  });

  it('copies declared SVG icons and canonicalizes capability order', async () => {
    const directory = await project(
      'export default { register() {} };',
      {
        capabilities: ['editor-ui', 'commands'],
        assets: { icons: ['./assets/icon.svg'] },
      },
    );
    await mkdir(join(directory, 'assets'));
    await writeFile(
      join(directory, 'assets/icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',
    );

    const result = await buildPlugin({ projectDirectory: directory });

    expect(result.manifest.capabilities).toEqual(['commands', 'editor-ui']);
    expect(
      await readFile(join(result.artifactDirectory, 'assets/icon.svg'), 'utf8'),
    ).toContain('<svg');
  });

  it('bundles declared module workers into hashed self-contained artifacts', async () => {
    const directory = await project(
      'export default { register() {} };',
      {
        capabilities: ['gpu-renderer'],
        assets: {
          workers: [{
            entry: './worker.ts',
            output: './workers/render.mjs',
          }],
        },
      },
    );
    await writeFile(
      join(directory, 'worker.ts'),
      'self.onmessage = () => undefined; export default {};',
    );

    const result = await buildPlugin({ projectDirectory: directory });
    const worker = await readFile(
      join(result.artifactDirectory, 'workers/render.mjs'),
      'utf8',
    );

    expect(result.manifest.workers).toEqual([
      expect.objectContaining({
        path: './workers/render.mjs',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(worker).not.toMatch(/(?:^|[;\n])\s*import\s+["']/u);
  });

  it('checks without publishing and creates deterministic archives', async () => {
    const directory = await project('export default { register() {} };');
    const checked = await checkPlugin({ projectDirectory: directory });
    await expect(readFile(join(directory, 'dist/fixture-react-editor/plugin.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(checked.manifest.id).toBe('fixture:react-editor');

    const first = await packPlugin({
      projectDirectory: directory,
      archivePath: 'first.editful-plugin',
    });
    const second = await packPlugin({
      projectDirectory: directory,
      archivePath: 'second.editful-plugin',
    });
    const firstBytes = await readFile(first.archivePath);
    const secondBytes = await readFile(second.archivePath);
    expect(firstBytes.equals(secondBytes)).toBe(true);
    expect(firstBytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(zipEntryNames(firstBytes)).toEqual(['plugin.json', 'plugin.mjs']);
  });

  it('rejects auxiliary outputs instead of silently shipping unusable files', async () => {
    const directory = await project(`
      import './styles.css';
      export default { register() {} };
    `);
    await writeFile(join(directory, 'styles.css'), '.fixture { color: red; }');

    await expect(buildPlugin({ projectDirectory: directory })).rejects.toThrow(
      /CSS|unsupported auxiliary assets/u,
    );
  });

  it('emits declared script origins and omits an empty declaration', async () => {
    const network = [
      {
        origin: 'https://maps.example.com',
        methods: ['GET'],
        purpose: 'Load the map library and its data',
      },
    ];
    const withScripts = await project('export default { register() {} };', {
      capabilities: ['editor-ui', 'network', 'external-scripts'],
      network,
      scripts: [{
        origin: 'https://maps.example.com',
        purpose: 'Run the vendor map library',
      }],
    });
    const built = await checkPlugin({ projectDirectory: withScripts });
    if (built.manifest.schemaVersion !== 2) throw new Error('expected schema 2');
    expect(built.manifest.scripts).toEqual([{
      origin: 'https://maps.example.com',
      purpose: 'Run the vendor map library',
    }]);
    expect(built.manifest.webAssembly).toBeNull();

    const withWebAssembly = await project('export default { register() {} };', {
      capabilities: ['editor-ui', 'network', 'external-scripts'],
      network,
      scripts: [{ origin: 'https://maps.example.com', purpose: 'Run the vendor map library' }],
      webAssembly: { purpose: 'Compile map label placement' },
    });
    const compiled = await buildPlugin({ projectDirectory: withWebAssembly });
    if (compiled.manifest.schemaVersion !== 2) throw new Error('expected schema 2');
    expect(compiled.manifest.webAssembly).toEqual({ purpose: 'Compile map label placement' });

    const withoutScripts = await project('export default { register() {} };');
    const result = await buildPlugin({ projectDirectory: withoutScripts });
    const manifest = JSON.parse(
      await readFile(join(result.artifactDirectory, 'plugin.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(Object.hasOwn(manifest, 'scripts')).toBe(false);
    expect(Object.hasOwn(manifest, 'webAssembly')).toBe(false);
  });

  it('explains script declarations Editful would refuse', async () => {
    const missingNetwork = await project('export default { register() {} };', {
      capabilities: ['editor-ui', 'external-scripts'],
      scripts: [{ origin: 'https://maps.example.com', purpose: 'Run code' }],
    });
    await expect(checkPlugin({ projectDirectory: missingNetwork })).rejects.toThrow(
      /scripts\[0\]\.origin "https:\/\/maps\.example\.com" must also be declared in network/u,
    );

    const missingCapability = await project('export default { register() {} };', {
      capabilities: ['editor-ui', 'network'],
      network: [{ origin: 'https://maps.example.com', methods: ['GET'], purpose: 'Data' }],
      scripts: [{ origin: 'https://maps.example.com', purpose: 'Run code' }],
    });
    await expect(checkPlugin({ projectDirectory: missingCapability })).rejects.toThrow(
      /require the "external-scripts" capability/u,
    );
  });

  describe('command toolbar order', () => {
    function commands(orders: readonly unknown[]): string {
      return `
        import { definePlugin } from '@editful/canvas-sdk';
        const TOOLS = ${JSON.stringify(orders.map((order, index) => ({ id: `fixture:tool-${index}`, order })))};
        export default definePlugin({
          register(context) {
            context.kind('fixture:card').field.number('size');
            context.editor({ id: 'fixture:panel', label: 'Panel', surface: 'right-sidebar', mount() {} });
            context.command({ id: 'fixture:palette-only', label: 'Palette only', async run() {} });
            for (const tool of TOOLS) {
              context.command({
                id: tool.id,
                label: tool.id,
                toolbar: { order: tool.order === 'NaN' ? Number.NaN : tool.order },
                async run() {},
              });
            }
          },
        });
      `;
    }

    it('accepts orders from -1000 to 1000', async () => {
      const directory = await project(commands([-1_000, 0, 1_000]), {
        capabilities: ['commands'],
      });
      const result = await checkPlugin({ projectDirectory: directory });
      expect(result.warnings).toEqual([]);
    });

    it.each([
      [1_001, /"fixture:tool-0" has toolbar\.order 1001; Editful accepts only integers from -1000 to 1000/u],
      [-1_001, /toolbar\.order -1001/u],
      [1.5, /toolbar\.order 1\.5/u],
      ['NaN', /toolbar\.order NaN/u],
      ['900', /toolbar\.order string/u],
    ])('rejects order %s', async (order, message) => {
      const directory = await project(commands([order]), {
        capabilities: ['commands'],
      });
      await expect(checkPlugin({ projectDirectory: directory })).rejects.toThrow(message);
    });

    it('reports every refused command at once', async () => {
      const directory = await project(commands([1_002, 1_003]), {
        capabilities: ['commands'],
      });
      await expect(checkPlugin({ projectDirectory: directory })).rejects.toThrow(
        /fixture:tool-0[^\n]*1002[^\n]*\n[^\n]*fixture:tool-1[^\n]*1003/u,
      );
    });

    it('warns instead of failing when register needs a browser', async () => {
      const directory = await project(`
        export default {
          register(context) {
            document.body.append('needs a browser');
            context.command({ id: 'fixture:late', label: 'Late', toolbar: { order: 5_000 }, async run() {} });
          },
        };
      `, { capabilities: ['commands'] });
      const result = await checkPlugin({ projectDirectory: directory });
      expect(result.warnings).toEqual([
        expect.stringMatching(/Skipped command contribution checks.*ReferenceError: document is not defined/u),
      ]);
    });

    it('treats orders computed from Editful-only values as unknown, not invalid', async () => {
      const directory = await project(`
        export default {
          register(context) {
            const preferred = context.settings.get('order') ?? 5;
            context.command({ id: 'fixture:stand-in', label: 'Stand-in', toolbar: { order: preferred }, async run() {} });
            context.command({ id: 'fixture:derived', label: 'Derived', toolbar: { order: context.layout.order + 1 }, async run() {} });
          },
        };
      `, { capabilities: ['commands'] });
      const result = await checkPlugin({ projectDirectory: directory });
      expect(result.warnings).toEqual([
        expect.stringMatching(/Could not check toolbar\.order for "fixture:stand-in", "fixture:derived"/u),
      ]);
    });

    it('ends loops driven by Editful-only values quickly', async () => {
      const directory = await project(`
        export default {
          register(context) {
            while (context.document.hasMore()) context.document.next();
          },
        };
      `, { capabilities: ['commands'] });
      const started = performance.now();
      const result = await checkPlugin({ projectDirectory: directory });
      expect(performance.now() - started).toBeLessThan(4_000);
      expect(result.warnings).toEqual([
        expect.stringMatching(/Skipped command contribution checks.*exist only inside Editful/u),
      ]);
    });

    it('registers the bundle without environment, files, network, or processes', async () => {
      process.env.EDITFUL_PLUGIN_TOOLS_TEST_SECRET = 'leaked';
      try {
        const directory = await project(`
          export default {
            async register(context) {
              const probe = {};
              const attempt = async (name, action) => {
                try {
                  await action();
                  probe[name] = 'allowed';
                } catch (error) {
                  probe[name] = error.code ?? error.cause?.code ?? error.name;
                }
              };
              const fs = process.getBuiltinModule('node:fs');
              await attempt('read', () => fs.readFileSync(${JSON.stringify(join(packageDirectory, 'package.json'))}));
              await attempt('write', () => fs.writeFileSync('probe.txt', 'x'));
              await attempt('child', () => process.getBuiltinModule('node:child_process').execFileSync('true'));
              await attempt('worker', () => new (process.getBuiltinModule('node:worker_threads').Worker)('1', { eval: true }));
              await attempt('fetch', () => fetch('http://127.0.0.1:65535/'));
              probe.secret = process.env.EDITFUL_PLUGIN_TOOLS_TEST_SECRET ?? 'absent';
              context.command({ id: JSON.stringify(probe), label: 'Probe', toolbar: { order: 5000 }, async run() {} });
            },
          };
        `, { capabilities: ['commands'] });
        const failure = await checkPlugin({ projectDirectory: directory }).then(
          () => { throw new Error('expected the probe order to fail'); },
          (error: unknown) => (error as Error).message,
        );
        const probe = JSON.parse(
          JSON.parse(/^Command ("(?:[^"\\]|\\.)*")/u.exec(failure)![1]!) as string,
        ) as Record<string, string>;
        expect(probe).toEqual({
          read: 'ERR_ACCESS_DENIED',
          write: 'ERR_ACCESS_DENIED',
          child: 'ERR_ACCESS_DENIED',
          worker: 'ERR_ACCESS_DENIED',
          fetch: 'ERR_ACCESS_DENIED',
          secret: 'absent',
        });
      } finally {
        delete process.env.EDITFUL_PLUGIN_TOOLS_TEST_SECRET;
      }
    });

    it('does not wait for timers the bundle leaves running', async () => {
      const directory = await project(`
        setInterval(() => undefined, 1_000);
        export default { register() {} };
      `, { capabilities: ['commands'] });
      const result = await checkPlugin({ projectDirectory: directory });
      expect(result.warnings).toEqual([]);
    });
  });

  it('rejects unsafe plugin ids and filesystem-root output', async () => {
    const unsafe = await project('export default { register() {} };', {
      id: '../../escape',
    });
    await expect(buildPlugin({ projectDirectory: unsafe })).rejects.toThrow(
      /publisher:name/u,
    );

    const safe = await project('export default { register() {} };');
    await expect(
      buildPlugin({ projectDirectory: safe, outputRoot: '/' }),
    ).rejects.toThrow(/filesystem root/u);
  });
});

function zipEntryNames(bytes: Buffer): readonly string[] {
  const endOffset = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(endOffset).toBeGreaterThanOrEqual(0);
  const count = bytes.readUInt16LE(endOffset + 10);
  let offset = bytes.readUInt32LE(endOffset + 16);
  const names: string[] = [];
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    names.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString());
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}
