import { timingSafeEqual } from 'node:crypto';
import { validationError } from './diagnostics.js';
import {
  RetainedPluginModule,
  decodePluginModule,
  sha256,
} from './module-source.js';
import type { ValidatedPluginModule } from './types.js';

/**
 * Process-local content-addressed cache for the future app-owned protocol.
 *
 * Entries contain copies of validated bytes. Serving code asks by digest and
 * never receives or reopens the original filesystem path.
 */
export class PluginArtifactCache {
  private readonly modules = new Map<string, ValidatedPluginModule>();

  get size(): number {
    return this.modules.size;
  }

  has(digest: string): boolean {
    return this.modules.has(digest);
  }

  get(digest: string): ValidatedPluginModule | null {
    return this.modules.get(digest) ?? null;
  }

  keys(): IterableIterator<string> {
    return this.modules.keys();
  }

  retain(module: ValidatedPluginModule): ValidatedPluginModule {
    const bytes = module.readBytes();
    const digest = sha256(bytes);
    if (digest !== module.digest) {
      throw validationError(
        'corrupt',
        'ENTRY_DIGEST_MISMATCH',
        'Validated plugin module bytes do not match their content address',
      );
    }

    const existing = this.modules.get(digest);
    if (existing !== undefined) {
      const existingBytes = existing.readBytes();
      if (
        existingBytes.byteLength !== bytes.byteLength ||
        !timingSafeEqual(existingBytes, bytes)
      ) {
        throw validationError(
          'corrupt',
          'ENTRY_DIGEST_MISMATCH',
          'Two different plugin modules claimed the same content address',
        );
      }
      return existing;
    }

    const retained = new RetainedPluginModule(
      bytes,
      decodePluginModule(bytes, 'cached-module'),
    );
    this.modules.set(digest, retained);
    return retained;
  }

  delete(digest: string): boolean {
    return this.modules.delete(digest);
  }

  clear(): void {
    this.modules.clear();
  }
}
