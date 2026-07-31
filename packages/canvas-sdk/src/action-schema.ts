import type { PluginJson } from './index.js';

const TYPES = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);
const COMMON = new Set(['type', 'enum', 'description']);
const BY_TYPE: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  object: new Set(['properties', 'required', 'additionalProperties']),
  array: new Set(['items', 'minItems', 'maxItems']),
  string: new Set(['minLength', 'maxLength']),
  number: new Set(['minimum', 'maximum']),
  integer: new Set(['minimum', 'maximum']),
  boolean: new Set<string>(),
  null: new Set<string>(),
});

/**
 * Validates the complete JSON-Schema subset supported by plugin actions.
 * Registration, desktop execution, and the MCP catalog all use this contract.
 */
export function validatePluginActionSchema(
  schema: Readonly<Record<string, PluginJson>>,
  path = 'action schema',
  depth = 0,
): void {
  if (depth > 32) throw new RangeError(`${path} exceeds the schema depth limit`);
  const type = schema['type'];
  if (type !== undefined && (typeof type !== 'string' || !TYPES.has(type))) {
    throw new TypeError(`${path}.type is unsupported`);
  }
  const allowed =
    typeof type === 'string'
      ? new Set([...COMMON, ...BY_TYPE[type]!])
      : COMMON;
  for (const key of Object.keys(schema)) {
    if (!allowed.has(key)) throw new TypeError(`${path}.${key} is unsupported`);
  }
  if (
    schema['description'] !== undefined &&
    (typeof schema['description'] !== 'string' ||
      schema['description'].length > 1_024)
  ) {
    throw new TypeError(`${path}.description is invalid`);
  }
  if (schema['enum'] !== undefined) {
    if (!Array.isArray(schema['enum']) || schema['enum'].length === 0) {
      throw new TypeError(`${path}.enum must contain at least one value`);
    }
  }
  if (type === 'object') validateObject(schema, path, depth);
  if (type === 'array') validateArray(schema, path, depth);
  if (type === 'string') validateBounds(schema, path, 'minLength', 'maxLength', true);
  if (type === 'number' || type === 'integer') {
    validateBounds(schema, path, 'minimum', 'maximum', false);
  }
}

function validateObject(
  schema: Readonly<Record<string, PluginJson>>,
  path: string,
  depth: number,
): void {
  const properties = schema['properties'];
  if (
    properties !== undefined &&
    (typeof properties !== 'object' ||
      properties === null ||
      Array.isArray(properties))
  ) {
    throw new TypeError(`${path}.properties must be an object`);
  }
  const propertyNames = new Set(Object.keys(properties ?? {}));
  for (const [name, child] of Object.entries(properties ?? {})) {
    if (
      typeof child !== 'object' ||
      child === null ||
      Array.isArray(child)
    ) {
      throw new TypeError(`${path}.properties.${name} must be a schema`);
    }
    validatePluginActionSchema(
      child as Readonly<Record<string, PluginJson>>,
      `${path}.properties.${name}`,
      depth + 1,
    );
  }
  const required = schema['required'];
  if (required !== undefined) {
    if (
      !Array.isArray(required) ||
      required.some((name) => typeof name !== 'string')
    ) {
      throw new TypeError(`${path}.required must be an array of strings`);
    }
    const names = required as readonly string[];
    if (
      new Set(names).size !== names.length ||
      names.some((name) => !propertyNames.has(name))
    ) {
      throw new TypeError(`${path}.required must name unique properties`);
    }
  }
  if (
    schema['additionalProperties'] !== undefined &&
    typeof schema['additionalProperties'] !== 'boolean'
  ) {
    throw new TypeError(`${path}.additionalProperties must be boolean`);
  }
}

function validateArray(
  schema: Readonly<Record<string, PluginJson>>,
  path: string,
  depth: number,
): void {
  const items = schema['items'];
  if (items !== undefined) {
    if (typeof items !== 'object' || items === null || Array.isArray(items)) {
      throw new TypeError(`${path}.items must be a schema`);
    }
    validatePluginActionSchema(
      items as Readonly<Record<string, PluginJson>>,
      `${path}.items`,
      depth + 1,
    );
  }
  validateBounds(schema, path, 'minItems', 'maxItems', true);
}

function validateBounds(
  schema: Readonly<Record<string, PluginJson>>,
  path: string,
  minimumKey: string,
  maximumKey: string,
  nonnegativeInteger: boolean,
): void {
  const minimum = schema[minimumKey];
  const maximum = schema[maximumKey];
  for (const [key, value] of [
    [minimumKey, minimum],
    [maximumKey, maximum],
  ] as const) {
    if (
      value !== undefined &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (nonnegativeInteger && (!Number.isInteger(value) || value < 0)))
    ) {
      throw new TypeError(`${path}.${key} is invalid`);
    }
  }
  if (
    typeof minimum === 'number' &&
    typeof maximum === 'number' &&
    minimum > maximum
  ) {
    throw new RangeError(`${path} has inverted bounds`);
  }
}
