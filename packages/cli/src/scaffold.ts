import { mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const SDK_VERSION = '^0.9.1';
const REACT_VERSION = '^19.2.0';
const TYPESCRIPT_VERSION = '^5.9.0';
const PLUGIN_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export interface ScaffoldPluginOptions {
  readonly name: string;
  readonly parentDirectory?: string;
}

export interface ScaffoldPluginResult {
  readonly directory: string;
  readonly name: string;
}

export async function scaffoldPlugin(
  options: ScaffoldPluginOptions,
): Promise<ScaffoldPluginResult> {
  const name = options.name.trim();
  if (!PLUGIN_NAME.test(name)) {
    throw new TypeError(
      'Plugin name must be lowercase words separated by hyphens, such as my-plugin',
    );
  }

  const parent = resolve(options.parentDirectory ?? process.cwd());
  const directory = resolve(parent, name);
  if (basename(directory) !== name) {
    throw new TypeError('Plugin name must resolve to one direct child directory');
  }

  try {
    await mkdir(directory);
  } catch (cause) {
    throw new Error(`Cannot create ${directory}; the directory may already exist`, {
      cause,
    });
  }
  await Promise.all([
    mkdir(resolve(directory, 'assets')),
    mkdir(resolve(directory, 'src')),
  ]);

  const files = projectFiles(name);
  await Promise.all(
    Object.entries(files).map(([relativePath, contents]) =>
      writeFile(resolve(directory, relativePath), contents, 'utf8')
    ),
  );
  return Object.freeze({ directory, name });
}

function projectFiles(name: string): Readonly<Record<string, string>> {
  const label = name
    .split('-')
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(' ');
  const packageJson = {
    name,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      typecheck: 'tsc --noEmit',
      check: 'editful-plugin check',
      build: 'editful-plugin build',
      dev: 'editful-plugin dev',
      pack: 'editful-plugin pack',
    },
    dependencies: {
      '@editful/canvas-sdk': SDK_VERSION,
      react: REACT_VERSION,
      'react-dom': REACT_VERSION,
    },
    devDependencies: {
      '@editful/plugin-tools': SDK_VERSION,
      '@types/react': REACT_VERSION,
      '@types/react-dom': REACT_VERSION,
      typescript: TYPESCRIPT_VERSION,
    },
  };

  return {
    '.gitignore': 'dist/\nnode_modules/\n*.editful-plugin\n',
    '.npmrc': '@editful:registry=https://npm.pkg.github.com\n',
    'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
    'tsconfig.json': `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        noEmit: true,
        jsx: 'react-jsx',
        skipLibCheck: true,
      },
      include: ['src/**/*.tsx', 'editful.plugin.ts'],
    }, null, 2)}\n`,
    'editful.plugin.ts': `import { definePluginConfig } from '@editful/plugin-tools';

export default definePluginConfig({
  id: 'local:${name}',
  name: '${label}',
  description: 'An Editful canvas plugin.',
  version: '1.0.0',
  entry: './src/index.tsx',
  minAppVersion: '0.9.0',
  maxAppVersion: '0.10.0',
  capabilities: ['commands'],
  assets: { icons: ['./assets/icon.svg'] },
});
`,
    'src/index.tsx': `import { definePlugin } from '@editful/canvas-sdk';

export default definePlugin({
  register(context) {
    context.command({
      id: 'local:${name}:hello',
      label: 'Say hello',
      toolbar: {
        icon: './assets/icon.svg',
        label: '${label}',
        order: 60,
      },
      async run(action) {
        action.ui.notify({
          title: 'Hello from ${label}',
          tone: 'success',
        });
      },
    });
  },
});
`,
    'assets/icon.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <path d="M12 2l1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" fill="currentColor"/>
</svg>
`,
    'README.md': `# ${label}

\`pnpm build\` creates an unpacked plugin. Use \`pnpm dev --root PATH\` to
write live builds to the plugins folder selected in Editful.
`,
  };
}
