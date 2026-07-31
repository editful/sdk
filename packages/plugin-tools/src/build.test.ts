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
      maxAppVersion: '0.9.0',
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
    ) as { id: string; sdkVersion: string; entrySha256: string };

    expect(manifest.id).toBe('fixture:react-editor');
    expect(manifest.sdkVersion).toBe('0.9.0');
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
