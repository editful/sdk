#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { scaffoldPlugin } from './scaffold.js';

try {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
  } else {
    const result = await scaffoldPlugin({ name: args.name! });
    console.log(`Created ${result.name} in ${result.directory}`);
    if (args.install) {
      await runInstall(args.packageManager, result.directory);
    } else {
      console.log(`Next: cd ${result.name} && ${args.packageManager} install`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

interface Arguments {
  readonly help: boolean;
  readonly name?: string;
  readonly install: boolean;
  readonly packageManager: 'pnpm' | 'npm';
}

function parseArguments(values: readonly string[]): Arguments {
  if (
    values.length === 0 ||
    values[0] === '--help' ||
    values[0] === '-h'
  ) {
    return { help: true, install: true, packageManager: 'pnpm' };
  }
  if (values[0] !== 'plugin' || values[1] !== 'new' || values[2] === undefined) {
    throw new TypeError('Expected editful plugin new NAME');
  }

  let install = true;
  let packageManager: 'pnpm' | 'npm' = 'pnpm';
  for (let index = 3; index < values.length; index++) {
    const value = values[index];
    if (value === '--no-install') {
      install = false;
    } else if (value === '--npm') {
      packageManager = 'npm';
    } else {
      throw new TypeError(`Unknown option ${JSON.stringify(value)}`);
    }
  }
  return { help: false, name: values[2], install, packageManager };
}

async function runInstall(
  packageManager: 'pnpm' | 'npm',
  directory: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(packageManager, ['install'], {
      cwd: directory,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(
        `${packageManager} install failed${signal === null ? ` with exit code ${code}` : ` from signal ${signal}`}`,
      ));
    });
  });
}

function printHelp(): void {
  console.log(`Editful CLI

Usage:
  editful plugin new NAME [--no-install] [--npm]

Options:
  --no-install  Create the project without installing dependencies
  --npm         Install with npm instead of pnpm`);
}
