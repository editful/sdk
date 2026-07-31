import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scaffoldPlugin } from './scaffold.js';

describe('scaffoldPlugin', () => {
  it('creates a React-ready plugin using the published packages', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'editful-cli-'));
    const result = await scaffoldPlugin({
      name: 'my-plugin',
      parentDirectory: parent,
    });
    const packageJson = JSON.parse(
      await readFile(join(result.directory, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

    expect(packageJson.dependencies['@editful/canvas-sdk']).toBe('^0.9.1');
    expect(packageJson.devDependencies['@editful/plugin-tools']).toBe('^0.9.1');
    expect(await readFile(join(result.directory, '.npmrc'), 'utf8')).toContain(
      'https://npm.pkg.github.com',
    );
    expect(await readFile(join(result.directory, 'src/index.tsx'), 'utf8')).toContain(
      "from '@editful/canvas-sdk'",
    );
  });

  it('rejects unsafe names and existing directories', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'editful-cli-'));
    await expect(scaffoldPlugin({ name: '../escape', parentDirectory: parent }))
      .rejects.toThrow('lowercase words');
    await scaffoldPlugin({ name: 'existing', parentDirectory: parent });
    await expect(scaffoldPlugin({ name: 'existing', parentDirectory: parent }))
      .rejects.toThrow('already exist');
  });
});
