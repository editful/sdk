import type {
  PluginManifest,
  PluginSettingDeclaration,
} from './types.js';

export type PluginSettingValue = string | number | boolean;

export interface ValidatedPluginSettings {
  readonly values: Readonly<Record<string, PluginSettingValue>>;
  readonly invalidKeys: readonly string[];
  readonly removedKeys: readonly string[];
}

/**
 * Reconciles untrusted persisted values with the current manifest schema.
 * Unknown and invalid values are reported and omitted; declared defaults are
 * copied into the effective view.
 */
export function validatePluginSettings(
  manifest: PluginManifest,
  stored: unknown,
): ValidatedPluginSettings {
  const declarations = manifest.schemaVersion === 2 ? manifest.settings : [];
  const record = isRecord(stored) ? stored : {};
  const declared = new Set(declarations.map(({ key }) => key));
  const values: Record<string, PluginSettingValue> = {};
  const invalidKeys: string[] = [];

  for (const declaration of declarations) {
    const candidate = record[declaration.key];
    if (candidate === undefined) {
      const fallback = defaultValue(declaration);
      if (fallback !== undefined) values[declaration.key] = fallback;
      continue;
    }
    if (validValue(declaration, candidate)) {
      values[declaration.key] = candidate;
    } else {
      invalidKeys.push(declaration.key);
      const fallback = defaultValue(declaration);
      if (fallback !== undefined) values[declaration.key] = fallback;
    }
  }

  return Object.freeze({
    values: Object.freeze(values),
    invalidKeys: Object.freeze(invalidKeys),
    removedKeys: Object.freeze(
      Object.keys(record)
        .filter((key) => !declared.has(key))
        .sort(),
    ),
  });
}

export function validPluginSettingValue(
  declaration: PluginSettingDeclaration,
  value: unknown,
): value is PluginSettingValue {
  return validValue(declaration, value);
}

function validValue(
  declaration: PluginSettingDeclaration,
  value: unknown,
): value is PluginSettingValue {
  switch (declaration.type) {
    case 'string':
      return typeof value === 'string' && value.length <= 4_096;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && declaration.values.includes(value);
    case 'secret-ref':
      return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 128 &&
        /^[A-Za-z0-9][A-Za-z0-9 ._@/-]*$/.test(value)
      );
  }
}

function defaultValue(
  declaration: PluginSettingDeclaration,
): PluginSettingValue | undefined {
  return declaration.type === 'secret-ref' ? undefined : declaration.default;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
