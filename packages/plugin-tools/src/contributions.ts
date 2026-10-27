import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

/** Editful refuses toolbar commands ordered outside this inclusive range. */
export const MIN_TOOLBAR_ORDER = -1_000;
export const MAX_TOOLBAR_ORDER = 1_000;

const EVALUATION_TIMEOUT_MS = 10_000;

export interface PluginContributionCheck {
  /** Contributions Editful would refuse to load. */
  readonly errors: readonly string[];
  /** Why contributions could not be checked; the build itself is unaffected. */
  readonly warnings: readonly string[];
}

/**
 * Runs in a disposable worker: imports the built bundle and calls `register`
 * against a recording context, checking command contributions the way
 * Editful's host does when it loads the plugin. Every other context method is
 * an inert stub, so no canvas work happens.
 */
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { url, pluginId, minimumOrder, maximumOrder } = workerData;

function describe(value) {
  return typeof value === 'number' ? String(value) : typeof value;
}

(async () => {
  const errors = [];
  const inert = new Proxy(function () {}, {
    get(_target, key) {
      if (key === 'then') return undefined;
      if (key === Symbol.toPrimitive) return () => '';
      if (key === Symbol.iterator) return function* () {};
      return inert;
    },
    apply() { return inert; },
    construct() { return inert; },
  });
  const command = (contribution) => {
    const id = typeof contribution?.id === 'string' ? contribution.id : '(unnamed)';
    const toolbar = contribution?.toolbar;
    if (toolbar === undefined) return;
    const order = toolbar?.order;
    if (
      !Number.isSafeInteger(order) ||
      order < minimumOrder ||
      order > maximumOrder
    ) {
      errors.push(
        'Command ' + JSON.stringify(id) + ' has toolbar.order ' + describe(order) +
          '; Editful accepts only integers from ' + minimumOrder + ' to ' +
          maximumOrder + ' and refuses to load the plugin otherwise',
      );
    }
  };
  const context = new Proxy({}, {
    get(_target, key) {
      if (key === 'pluginId') return pluginId;
      if (key === 'command') return command;
      if (key === 'then') return undefined;
      return inert;
    },
  });
  try {
    const plugin = (await import(url)).default;
    if (typeof plugin?.register !== 'function') {
      throw new TypeError('the default export has no register function');
    }
    await plugin.register(context);
    parentPort.postMessage({ ok: true, errors });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      message: error instanceof Error ? error.name + ': ' + error.message : String(error),
    });
  }
})();
`;

/**
 * Checks the command contributions a built plugin registers. Plugin code runs
 * in a worker thread that is always terminated afterwards, so timers or
 * pending work the bundle starts cannot keep the build alive.
 */
export async function checkPluginContributions(
  modulePath: string,
  pluginId: string,
): Promise<PluginContributionCheck> {
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      url: pathToFileURL(modulePath).href,
      pluginId,
      minimumOrder: MIN_TOOLBAR_ORDER,
      maximumOrder: MAX_TOOLBAR_ORDER,
    },
    stdout: true,
    stderr: true,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await new Promise<
      | { readonly ok: true; readonly errors: readonly string[] }
      | { readonly ok: false; readonly message: string }
    >((resolve) => {
      timer = setTimeout(
        () => resolve({
          ok: false,
          message: `register did not finish within ${EVALUATION_TIMEOUT_MS / 1_000} seconds`,
        }),
        EVALUATION_TIMEOUT_MS,
      );
      worker.once('message', resolve);
      worker.once('error', (error: Error) => resolve({ ok: false, message: error.message }));
      worker.once('exit', (code) => resolve({
        ok: false,
        message: `the evaluation worker exited with code ${code}`,
      }));
    });
    if (outcome.ok) {
      return Object.freeze({
        errors: Object.freeze([...outcome.errors]),
        warnings: Object.freeze([]),
      });
    }
    return Object.freeze({
      errors: Object.freeze([]),
      warnings: Object.freeze([
        `Skipped command contribution checks because plugin.mjs could not be registered outside Editful (${outcome.message})`,
      ]),
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await worker.terminate();
  }
}
