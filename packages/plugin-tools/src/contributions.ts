import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Editful refuses toolbar commands ordered outside this inclusive range. */
export const MIN_TOOLBAR_ORDER = -1_000;
export const MAX_TOOLBAR_ORDER = 1_000;

const EVALUATION_TIMEOUT_MS = 5_000;
const EVALUATION_HEAP_MB = 128;
/** Stand-in operations allowed before register is presumed to be looping. */
const STAND_IN_LIMIT = 100_000;
const MAX_REPORT_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 4 * 1024;

export interface PluginContributionCheck {
  /** Contributions Editful would refuse to load. */
  readonly errors: readonly string[];
  /** Checks that could not reach a verdict; the build itself is unaffected. */
  readonly warnings: readonly string[];
}

/**
 * Runs as a CommonJS `-e` script in a sandboxed child process: imports the
 * built bundle and calls `register` against a recording context, checking
 * command contributions the way Editful's host does when it loads the plugin.
 *
 * Every other context member is a stand-in that only exists inside Editful.
 * A toolbar order that is, or was computed from, a stand-in cannot be judged,
 * so it is reported as uncertain rather than as an error. Stand-ins stop
 * working after a bounded number of uses so a loop driven by one ends fast.
 * The result is written to file descriptor 3, away from plugin console output.
 */
const CHILD_SOURCE = String.raw`
'use strict';
const { writeSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const [bundlePath, pluginId, minimumText, maximumText, limitText] = process.argv.slice(1);
const minimum = Number(minimumText);
const maximum = Number(maximumText);
const limit = Number(limitText);

function report(result) {
  writeSync(3, JSON.stringify(result) + '\n');
}

function describe(value) {
  if (typeof value === 'number') return String(value);
  return value === null ? 'null' : typeof value;
}

class StandInLimitError extends Error {}
let uses = 0;
let coerced = false;
function use() {
  if (++uses > limit) {
    throw new StandInLimitError('register kept using values that exist only inside Editful');
  }
}
const standIn = new Proxy(function () {}, {
  get(_target, key) {
    if (key === 'then') return undefined;
    use();
    if (key === Symbol.toPrimitive) {
      return (hint) => {
        coerced = true;
        return hint === 'string' ? '' : Number.NaN;
      };
    }
    if (key === Symbol.iterator) return function* () {};
    return standIn;
  },
  has() { return false; },
  apply() { use(); return standIn; },
  construct() { use(); return standIn; },
});

const errors = [];
const uncertain = [];
function command(contribution) {
  const id = typeof contribution?.id === 'string' ? contribution.id : '(unnamed)';
  const toolbar = contribution?.toolbar;
  if (toolbar === undefined) return;
  if (toolbar === standIn) {
    uncertain.push(id);
    return;
  }
  const order = toolbar?.order;
  if (Number.isSafeInteger(order) && order >= minimum && order <= maximum) return;
  if (order === standIn || coerced) {
    uncertain.push(id);
    return;
  }
  errors.push(
    'Command ' + JSON.stringify(id) + ' has toolbar.order ' + describe(order) +
      '; Editful accepts only integers from ' + minimum + ' to ' + maximum +
      ' and refuses to load the plugin otherwise',
  );
}
const context = new Proxy({}, {
  get(_target, key) {
    if (key === 'pluginId') return pluginId;
    if (key === 'command') return command;
    if (key === 'then') return undefined;
    return standIn;
  },
});

(async () => {
  try {
    const plugin = (await import(pathToFileURL(bundlePath).href)).default;
    if (typeof plugin?.register !== 'function') {
      throw new TypeError('the default export has no register function');
    }
    await plugin.register(context);
    report({ ok: true, errors, uncertain });
  } catch (error) {
    report({
      ok: false,
      message: error instanceof Error ? error.name + ': ' + error.message : String(error),
    });
  }
})();
`;

type Outcome =
  | {
      readonly ok: true;
      readonly errors: readonly string[];
      readonly uncertain: readonly string[];
    }
  | { readonly ok: false; readonly message: string };

/**
 * Checks the command contributions a built plugin registers.
 *
 * The bundle runs in a child process under Node's permission model with an
 * empty environment: it may read only its own bundle file, and file writes,
 * network access, child processes, worker threads, native addons, WASI, and
 * the inspector are all denied. The process gets a small heap, is killed once
 * it reports or after a short timeout, and cannot keep the build alive.
 */
export async function checkPluginContributions(
  modulePath: string,
  pluginId: string,
): Promise<PluginContributionCheck> {
  const outcome = await evaluate(await realpath(modulePath), pluginId);
  if (!outcome.ok) {
    return Object.freeze({
      errors: Object.freeze([]),
      warnings: Object.freeze([
        `Skipped command contribution checks because plugin.mjs could not be registered outside Editful (${outcome.message})`,
      ]),
    });
  }
  return Object.freeze({
    errors: Object.freeze([...outcome.errors]),
    warnings: Object.freeze(
      outcome.uncertain.length === 0
        ? []
        : [
            `Could not check toolbar.order for ${outcome.uncertain.map((id) => JSON.stringify(id)).join(', ')} because it depends on values that exist only inside Editful; Editful refuses orders that are not integers from ${MIN_TOOLBAR_ORDER} to ${MAX_TOOLBAR_ORDER}`,
          ],
    ),
  });
}

function evaluate(bundlePath: string, pluginId: string): Promise<Outcome> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${bundlePath}`,
        `--max-old-space-size=${EVALUATION_HEAP_MB}`,
        '--input-type=commonjs',
        '-e',
        CHILD_SOURCE,
        bundlePath,
        pluginId,
        String(MIN_TOOLBAR_ORDER),
        String(MAX_TOOLBAR_ORDER),
        String(STAND_IN_LIMIT),
      ],
      {
        cwd: dirname(bundlePath),
        env: {},
        stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let settled = false;
    let report = '';
    let stderr = '';
    const finish = (outcome: Outcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(outcome);
    };
    const timer = setTimeout(
      () => finish({
        ok: false,
        message: `register did not finish within ${EVALUATION_TIMEOUT_MS / 1_000} seconds`,
      }),
      EVALUATION_TIMEOUT_MS,
    );
    child.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk;
    });
    const results = child.stdio[3] as NodeJS.ReadableStream;
    results.setEncoding('utf8');
    results.on('data', (chunk: string) => {
      report += chunk;
      if (report.length > MAX_REPORT_BYTES) {
        finish({ ok: false, message: 'the evaluation report was too large' });
        return;
      }
      const end = report.indexOf('\n');
      if (end === -1) return;
      try {
        finish(parseOutcome(JSON.parse(report.slice(0, end))));
      } catch {
        finish({ ok: false, message: 'the evaluation report was malformed' });
      }
    });
    child.once('error', (error) => finish({ ok: false, message: error.message }));
    child.once('close', (code, signal) => {
      const detail = lastLine(stderr);
      finish({
        ok: false,
        message: `the evaluation process exited with ${signal ?? `code ${code}`}${detail === '' ? '' : `: ${detail}`}`,
      });
    });
  });
}

function parseOutcome(value: unknown): Outcome {
  if (typeof value !== 'object' || value === null) throw new TypeError('malformed');
  const record = value as Record<string, unknown>;
  if (record.ok === false && typeof record.message === 'string') {
    return { ok: false, message: record.message };
  }
  if (
    record.ok === true &&
    isStringArray(record.errors) &&
    isStringArray(record.uncertain)
  ) {
    return { ok: true, errors: record.errors, uncertain: record.uncertain };
  }
  throw new TypeError('malformed');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function lastLine(text: string): string {
  return text.trim().split('\n').at(-1)?.trim().slice(0, 300) ?? '';
}
