# `@editful/plugin-artifact`

Platform-neutral Node validation for Editful sideload artifacts. This package
does not discover directories, execute plugin code, or know about Electron.

An artifact directory contains:

```text
plugin-directory/
  plugin.json
  plugin.mjs
  assets/
    optional-toolbar-icon.svg
```

`plugin.mjs` is one self-contained UTF-8 ESM bundle. Static imports, side-effect
imports, re-exports, and dynamic imports are rejected using
`es-module-lexer`; JavaScript syntax is checked with Acorn. `import.meta` and
inline source maps are allowed. External source maps and auxiliary chunks are
not. Optional asset directories may contain only bounded passive SVG toolbar
icons. The validator rejects scripts, event handlers, external references,
symlinks, and active embedded content.

## Manifest schema 1

```json
{
  "schemaVersion": 1,
  "id": "example:status-card",
  "name": "Status Card",
  "description": "A labeled status gauge.",
  "version": "1.0.0",
  "entry": "plugin.mjs",
  "sdkVersion": "0.9.0",
  "minAppVersion": "0.9.0",
  "capabilities": ["node-kinds"],
  "entrySha256": "<64 lowercase hex characters>",
  "author": "Example Team",
  "homepage": "https://example.com/status-card",
  "source": "https://github.com/example/status-card"
}
```

The plugin's app requirement is lower-inclusive with no upper bound. The host
owns an inclusive SDK compatibility range, allowing newer Editful releases to
keep running older plugin contracts. Legacy manifests containing
`maxAppVersion` remain accepted, but current hosts ignore that field. Schema 1
supports only `node-kinds` and remains permanently accepted during the schema-2
compatibility window.

## Manifest schema 2

Schema 2 adds explicit capability declarations for `commands`, `importers`,
`network`, `configuration`, `secrets`, `remote-media`,
`interaction-regions`, `agent-actions`, `gpu-renderer`, and
`external-scripts`. Network, remote-media, and script entries use exact HTTPS
origins—wildcards, credentials, ports, paths, queries, and fragments are
rejected. Settings use bounded scalar defaults and secret settings contain only
named references, never secret values.

### External scripts

Some vendor libraries, such as Google's Maps JavaScript API, cannot be bundled
and must load their code from the vendor's origin. A plugin that needs this
declares each origin in `scripts` and adds the `external-scripts` capability:

```json
{
  "capabilities": ["editor-ui", "network", "external-scripts"],
  "network": [
    {
      "origin": "https://maps.googleapis.com",
      "methods": ["GET"],
      "purpose": "Load Google Maps data for map editors."
    }
  ],
  "scripts": [
    {
      "origin": "https://maps.googleapis.com",
      "purpose": "Run Google's Maps JavaScript API in map editors."
    }
  ]
}
```

- At most 4 entries, each with an exact HTTPS `origin` and a `purpose` of up
  to 240 characters shown to users.
- Every script origin must also appear in `network`. Being allowed to fetch an
  origin never implies running its code, and running an origin's code never
  silently grants connections to it; both are declared.
- `scripts` is omitted when a plugin declares none. Editful releases that
  predate script origins reject manifests containing `scripts` or
  `external-scripts`, so set `minAppVersion` to a release that supports them.

Hosts decide how to honor a declaration. Editful adds the origins of enabled
plugins to its renderer's content security policy when it starts, so a newly
declared script origin takes effect after Editful restarts.

The validated artifact retains two independent identities:

- `manifestDigest` hashes the exact accepted `plugin.json` bytes, so
  disclosure-only changes publish a new candidate.
- `digest` hashes `plugin.mjs` and addresses the immutable secure module URL.

Returned declarations are copied and recursively frozen. These declarations
are disclosures and host API contracts for trusted local code, not a
per-plugin sandbox.

## Validation

```ts
const cache = new PluginArtifactCache();
const artifact = await validatePluginArtifact(directory, {
  appVersion: '0.9.0',
  minSdkVersion: '0.8.0',
  maxSdkVersion: '0.9.0',
  cache,
});

const bytes = cache.get(artifact.module.digest)?.readBytes();
```

The retained module owns a private copy of the bytes that were syntax-checked
and hashed. `readBytes()` returns another copy. Future protocol code must serve
these retained bytes by digest; it must never reopen `artifact.directory`.

Failures throw `PluginArtifactValidationError` with one of five stable
categories:

- `missing`
- `malformed`
- `incompatible`
- `unsupported`
- `corrupt`

`validatePluginArtifactResult` returns the same diagnostic as a result union
for batch validation and UI callers.
