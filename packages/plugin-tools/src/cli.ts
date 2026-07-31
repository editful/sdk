#!/usr/bin/env node
import { watch } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  buildPlugin,
  checkPlugin,
  formatBytes,
  packPlugin,
  type PluginBuildOptions,
  type PluginBuildResult,
} from './build.js';

interface Arguments {
  readonly command: 'build' | 'check' | 'dev' | 'pack' | 'help';
  readonly projectDirectory: string;
  readonly config?: string;
  readonly outputRoot?: string;
  readonly archivePath?: string;
}

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.command === 'help') {
    printHelp();
  } else if (args.command === 'build') {
    report(await buildPlugin(buildOptions(args)));
  } else if (args.command === 'check') {
    report(await checkPlugin(buildOptions(args)), 'Validated');
  } else if (args.command === 'pack') {
    const result = await packPlugin({
      ...buildOptions(args),
      archivePath: args.archivePath,
    });
    report(result);
    console.log(`Packed ${result.archivePath} (${formatBytes(result.archiveBytes)})`);
  } else {
    await develop(args);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function develop(args: Arguments): Promise<void> {
  let building = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rebuild = async (): Promise<void> => {
    if (building) {
      pending = true;
      return;
    }
    building = true;
    try {
      report(await buildPlugin({ ...buildOptions(args), development: true }));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    } finally {
      building = false;
      if (pending) {
        pending = false;
        await rebuild();
      }
    }
  };
  await rebuild();
  const output = args.outputRoot === undefined
    ? resolve(args.projectDirectory, 'dist')
    : resolve(args.projectDirectory, args.outputRoot);
  const watcher = watch(
    args.projectDirectory,
    { recursive: true },
    (_event, filename) => {
      if (filename === null || ignored(filename, output, args.projectDirectory)) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), 100);
    },
  );
  console.log(`Watching ${args.projectDirectory}`);
  await new Promise<void>((resolveClose) => {
    const close = (): void => {
      watcher.close();
      resolveClose();
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  });
}

function ignored(filename: string, output: string, project: string): boolean {
  const normalized = filename.split(sep).join('/');
  if (
    normalized === 'node_modules' ||
    normalized.startsWith('node_modules/') ||
    normalized === '.git' ||
    normalized.startsWith('.git/')
  ) {
    return true;
  }
  const outputRelative = relative(project, output).split(sep).join('/');
  return outputRelative !== '' &&
    !outputRelative.startsWith('../') &&
    (normalized === outputRelative || normalized.startsWith(`${outputRelative}/`));
}

function buildOptions(args: Arguments): PluginBuildOptions {
  return {
    projectDirectory: args.projectDirectory,
    config: args.config,
    outputRoot: args.outputRoot,
  };
}

function report(result: PluginBuildResult, verb = 'Built'): void {
  const destination = verb === 'Validated' ? '' : ` → ${result.artifactDirectory}`;
  console.log(
    `${verb} ${result.manifest.id}@${result.manifest.version}${destination} (${formatBytes(result.bundleBytes)} / ${formatBytes(result.maximumBundleBytes)})`,
  );
}

function parseArguments(values: readonly string[]): Arguments {
  const first = values[0];
  const command = first === undefined || first === '--help' || first === '-h'
    ? 'help'
    : first;
  if (!['build', 'check', 'dev', 'pack', 'help'].includes(command)) {
    throw new TypeError(`Unknown command ${JSON.stringify(command)}`);
  }
  let projectDirectory = process.cwd();
  let config: string | undefined;
  let outputRoot: string | undefined;
  let archivePath: string | undefined;
  for (let index = 1; index < values.length; index++) {
    const value = values[index]!;
    const next = values[index + 1];
    if (value === '--') {
      continue;
    } else if (value === '--project' && next !== undefined) {
      projectDirectory = resolve(next);
      index++;
    } else if (value === '--config' && next !== undefined) {
      config = next;
      index++;
    } else if ((value === '--out-dir' || value === '--root') && next !== undefined) {
      outputRoot = next;
      index++;
    } else if (value === '--archive' && next !== undefined) {
      archivePath = next;
      index++;
    } else {
      throw new TypeError(`Unknown or incomplete option ${JSON.stringify(value)}`);
    }
  }
  return {
    command: command as Arguments['command'],
    projectDirectory,
    ...(config === undefined ? {} : { config }),
    ...(outputRoot === undefined ? {} : { outputRoot }),
    ...(archivePath === undefined ? {} : { archivePath }),
  };
}

function printHelp(): void {
  console.log(`Editful plugin tools

Usage:
  editful-plugin build [--project DIR] [--out-dir DIR]
  editful-plugin check [--project DIR]
  editful-plugin dev [--project DIR] [--root EDITFUL_PLUGINS_DIR]
  editful-plugin pack [--project DIR] [--archive FILE]

Options:
  --config FILE   Use an explicit config instead of editful.plugin.{ts,mts,js,mjs}
  --project DIR   Plugin project directory (default: current directory)
  --out-dir DIR   Artifact root containing one direct child per plugin
  --root DIR      Alias for --out-dir, intended for Editful's selected plugin folder
  --archive FILE  Destination for the deterministic .editful-plugin archive`);
}
