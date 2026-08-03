export type PluginArtifactDiagnosticCategory =
  | 'missing'
  | 'malformed'
  | 'incompatible'
  | 'unsupported'
  | 'corrupt';

export type PluginArtifactDiagnosticCode =
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_NOT_DIRECTORY'
  | 'ARTIFACT_UNREADABLE'
  | 'ARTIFACT_FILES_UNSUPPORTED'
  | 'MANIFEST_MISSING'
  | 'MANIFEST_NOT_REGULAR'
  | 'MANIFEST_TOO_LARGE'
  | 'MANIFEST_INVALID_UTF8'
  | 'MANIFEST_INVALID_JSON'
  | 'MANIFEST_INVALID_SHAPE'
  | 'MANIFEST_FIELD_INVALID'
  | 'MANIFEST_KEY_UNSUPPORTED'
  | 'MANIFEST_SCHEMA_UNSUPPORTED'
  | 'APP_INCOMPATIBLE'
  | 'SDK_INCOMPATIBLE'
  | 'CAPABILITY_UNSUPPORTED'
  | 'ENTRY_MISSING'
  | 'ENTRY_PATH_INVALID'
  | 'ENTRY_ESCAPES_ARTIFACT'
  | 'ENTRY_NOT_REGULAR'
  | 'ENTRY_TOO_LARGE'
  | 'ENTRY_INVALID_UTF8'
  | 'ENTRY_DIGEST_MISMATCH'
  | 'ENTRY_SYNTAX_INVALID'
  | 'ENTRY_IMPORT_UNSUPPORTED'
  | 'ENTRY_SOURCE_MAP_UNSUPPORTED'
  | 'ICON_PATH_INVALID'
  | 'ICON_NOT_REGULAR'
  | 'ICON_TOO_LARGE'
  | 'ICON_COUNT_EXCEEDED'
  | 'ICON_INVALID_UTF8'
  | 'ICON_SVG_INVALID'
  | 'WORKER_MISSING'
  | 'WORKER_NOT_REGULAR'
  | 'WORKER_TOO_LARGE'
  | 'WORKER_DIGEST_MISMATCH';

export interface PluginArtifactDiagnostic {
  readonly category: PluginArtifactDiagnosticCategory;
  readonly code: PluginArtifactDiagnosticCode;
  readonly message: string;
  readonly path?: string;
  readonly pluginId?: string;
}

/** Typed validation failure suitable for both logs and compatibility UI. */
export class PluginArtifactValidationError extends Error {
  readonly diagnostic: PluginArtifactDiagnostic;

  constructor(diagnostic: PluginArtifactDiagnostic, options?: ErrorOptions) {
    super(diagnostic.message, options);
    this.name = 'PluginArtifactValidationError';
    this.diagnostic = Object.freeze({ ...diagnostic });
  }
}

export function validationError(
  category: PluginArtifactDiagnosticCategory,
  code: PluginArtifactDiagnosticCode,
  message: string,
  details: {
    path?: string;
    pluginId?: string;
    cause?: unknown;
  } = {},
): PluginArtifactValidationError {
  const diagnostic: PluginArtifactDiagnostic = {
    category,
    code,
    message,
    ...(details.path === undefined ? {} : { path: details.path }),
    ...(details.pluginId === undefined ? {} : { pluginId: details.pluginId }),
  };
  return new PluginArtifactValidationError(diagnostic, {
    cause: details.cause,
  });
}

export function isValidationError(
  error: unknown,
): error is PluginArtifactValidationError {
  return error instanceof PluginArtifactValidationError;
}
