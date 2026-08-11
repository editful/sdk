# @editful/plugin-artifact

## 0.13.0

### Minor Changes

- 6cc48d0: Add plugin binding registration and document transaction relation/record APIs.

## 0.12.0

## 0.11.0

### Minor Changes

- c0a9445: Add capability-gated retained WebGL surface renderers, renderer-lifetime I/O
  and worker services, rendered-feature queries, and validated bundled module
  worker assets for high-performance canvas plugins.

## 0.10.0

## 0.9.2

## 0.9.1

## 0.9.0

### Minor Changes

- c7a6847: Add trusted plugin-owned HTML and React editor surfaces for the direct toolbar
  and conditional left and right sidebars. Move shape and note appearance
  controls into their plugins, move typography into the text plugin's right
  sidebar, and expose undoable paint and text style properties through the
  plugin document boundary.

  Keep note styling intentionally constrained to the built-in color swatches and
  render notes with a fixed subtle shadow instead of an editable border.

  Allow workflow editors to opt into plugin-scoped manual activation with
  transient bounded JSON state. Move the Unsplash search picker into its
  plugin-owned right sidebar and add a selection-aware Change photo toolbar
  editor whose field-only replacement preserves canvas geometry.

  Unify software-update, image-transfer, remote-image, and local-plugin activity
  in one dismissible lower-left notification tray while retaining the canvas
  connectivity pill. Let plugins publish bounded host-positioned notices through
  `action.ui.notify`, and move plugin reload, diagnostic, and quarantine controls
  into the management panel.

  Allow plugin toolbar commands to reflect a manual editor's active state, use a
  toolbar-specific label, and dismiss the active editor when empty canvas or a
  different object is chosen. The Unsplash fixture now appears as **Unsplash**,
  supersedes the core tool highlight, and behaves like a selected tool until
  placement or canvas dismissal; clicking the current selection keeps it active.
  Successful Unsplash discovery pages are reused for ten minutes per board so
  reopening the tool does not spend another upstream request.
  The Rust Unsplash proxy also shares each successful discovery page for ten
  minutes, while still authenticating every board request and issuing fresh
  per-user download grants from cached results.
  Render the Unsplash toolbar action with the canonical vector brand glyph.
  Simplify tray notifications by removing category eyebrows and coloured left
  borders. The active local-plugin notice and successful image-upload notice now
  use title-only copy.
  Vertically center title-only notification content against its glyph and close
  control.
  Keep image downloads and uploads completing within two seconds out of the tray.
  Slow uploads show current progress after two seconds and then confirm completion;
  upload and download failures still appear immediately.
  Remove the redundant trusted-local-code eyebrow and introductory disclosure
  from the plugin management header.
  Bump the Unsplash conformance fixture to 0.1.2 for local update testing.
  Keep the pending plugin-reload notification visible until it is acted on or
  explicitly dismissed.
  Let installed local plugins be enabled or disabled from the Plugins settings
  panel, persist that choice per OS profile, and stage changes through the safe
  runtime reload flow while keeping disabled plugins available for re-enabling.
  Replace the canvas back button with a hamburger menu containing Back to boards
  and Manage plugins actions.
  Offer a Reload Editful action when changed plug-in media policy requires the
  application to relaunch before activation.
  Keep that action attached to the live Vite host in development and recompute
  the development image CSP on reload, avoiding a blank orphaned window.
  Allow plug-ins to bundle bounded passive SVG files and reference them with
  explicit relative toolbar icon paths. Move built-in shape, note, text, image,
  and Unsplash glyphs into their owning plug-ins instead of the host UI registry.

## 0.8.0

### Minor Changes

- 750f33a: Add trusted local schema-2 plugins with transactional commands and importers,
  declared network and remote-image access, profile-local configuration,
  accessible interaction regions, and live MCP actions. Remote image URLs remain
  ordinary plugin fields, while attribution stays entirely plugin-owned through
  generic text and link regions. Plugins can probe declared remote images for
  their decoded dimensions through the bounded host cache. Action schemas now
  share one enforced subset across plugin registration, desktop execution, and
  the live MCP catalog.
  The Unsplash conformance plugin mirrors its human search-and-place workflow
  through plugin-owned search, preview, and placement actions while retaining
  direct `remote_photo` composition. Search results contain no URLs, and MCP
  emits preview image data outside the JSON text response.

## 0.7.0

### Minor Changes

- a199841: Add explicit local plugin-root discovery, watched last-known-good artifacts,
  transactional offscreen runtime reconstruction, visible undo-reset consent,
  digest-scoped pack quarantine, and actionable desktop plugin diagnostics while
  keeping every local-source module out of the web target. Allow Vite-served
  desktop development to import validated digest modules through an
  unpackaged-only exact-origin CSP/CORS gate.
