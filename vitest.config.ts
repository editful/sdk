import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const source = (name: string) =>
  resolve(import.meta.dirname, `packages/${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    alias: {
      '@editful/canvas-sdk': source('canvas-sdk'),
      '@editful/plugin-artifact': source('plugin-artifact'),
      '@editful/plugin-tools': source('plugin-tools'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
