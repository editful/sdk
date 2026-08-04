import { createHash } from 'node:crypto';
import { parse as parseJavaScript } from 'acorn';
import {
  ImportType,
  init as initializeModuleLexer,
  parse as parseModuleImports,
} from 'es-module-lexer';
import { validationError } from './diagnostics.js';
import type { ValidatedPluginModule } from './types.js';

interface Comment {
  readonly value: string;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function decodePluginModule(bytes: Uint8Array, pluginId: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw validationError(
      'corrupt',
      'ENTRY_INVALID_UTF8',
      'plugin.mjs is not valid UTF-8',
      { pluginId, cause },
    );
  }
}

/**
 * Parses the complete JavaScript grammar, then uses es-module-lexer—not a
 * regular expression—to identify every static, re-export, and dynamic import.
 */
export async function validatePluginModuleSource(
  source: string,
  pluginId: string,
  options: { readonly allowDynamicImports?: boolean } = {},
): Promise<void> {
  const comments: Comment[] = [];
  try {
    parseJavaScript(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: true,
      onComment: (_block, value) => comments.push({ value }),
    });
  } catch (cause) {
    const detail =
      cause instanceof Error && cause.message !== ''
        ? `: ${cause.message}`
        : '';
    throw validationError(
      'malformed',
      'ENTRY_SYNTAX_INVALID',
      `plugin.mjs contains invalid JavaScript syntax${detail}`,
      { pluginId, cause },
    );
  }

  await initializeModuleLexer;
  let imports: readonly {
    readonly n: string | undefined;
    readonly t: ImportType;
    readonly s: number;
    readonly e: number;
  }[];
  let exports: readonly { readonly n: string }[];
  try {
    [imports, exports] = parseModuleImports(source);
  } catch (cause) {
    throw validationError(
      'malformed',
      'ENTRY_SYNTAX_INVALID',
      'plugin.mjs contains module syntax the host cannot parse',
      { pluginId, cause },
    );
  }

  const runtimeImport = imports.find(
    (entry) =>
      entry.t !== ImportType.ImportMeta &&
      !(
        options.allowDynamicImports === true &&
        (entry.t === ImportType.Dynamic ||
          entry.t === ImportType.DynamicSourcePhase)
      ),
  );
  if (runtimeImport !== undefined) {
    const specifier =
      runtimeImport.n ??
      source.slice(runtimeImport.s, runtimeImport.e);
    throw validationError(
      'unsupported',
      'ENTRY_IMPORT_UNSUPPORTED',
      `plugin.mjs must be self-contained; runtime import ${JSON.stringify(specifier)} is not supported`,
      { pluginId },
    );
  }

  if (!exports.some((entry) => entry.n === 'default')) {
    throw validationError(
      'malformed',
      'ENTRY_SYNTAX_INVALID',
      'plugin.mjs must provide a default export',
      { pluginId },
    );
  }

  for (const comment of comments) {
    const match = /[#@]\s*sourceMappingURL\s*=\s*(\S+)/u.exec(comment.value);
    if (match === null || match[1]?.startsWith('data:')) continue;
    throw validationError(
      'unsupported',
      'ENTRY_SOURCE_MAP_UNSUPPORTED',
      'plugin.mjs may contain an inline source map but may not reference an external source map',
      { pluginId },
    );
  }
}

/** Internal immutable implementation; callers only receive the public view. */
export class RetainedPluginModule implements ValidatedPluginModule {
  readonly digest: string;
  readonly byteLength: number;
  readonly source: string;
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array, source: string) {
    this.#bytes = Uint8Array.from(bytes);
    this.digest = sha256(this.#bytes);
    this.byteLength = this.#bytes.byteLength;
    this.source = source;
    Object.freeze(this);
  }

  readBytes(): Uint8Array {
    return this.#bytes.slice();
  }
}
