# Editful Canvas SDK

Build trusted local plugins for the Editful canvas without depending on the
Editful application source tree.

This repository contains the complete public plugin-development surface:

- [`@editful/plugin-sdk`](packages/plugin-sdk) — typed authoring contract for
  canvas kinds, commands, editor surfaces, imports, network access, and agent
  actions.
- [`@editful/plugin-tools`](packages/plugin-tools) — TypeScript, TSX, React, and
  npm dependency bundling; development watch mode; artifact validation; and
  deterministic `.editful-plugin` archives.
- [`@editful/plugin-artifact`](packages/plugin-artifact) — platform-neutral
  validation for unpacked Editful plugin artifacts.
- [`examples/react-plugin`](examples/react-plugin) — a small, buildable React
  sidebar plugin.

The Editful desktop application and its canvas implementation are deliberately
not dependencies of this repository. Plugins compile only against the narrow
SDK contract and ship as self-contained artifacts.

## Requirements

- Node.js 26 or newer
- pnpm 11.13.1 or newer

## Get started

```bash
pnpm install
pnpm check
pnpm --dir examples/react-plugin build
pnpm --dir examples/react-plugin pack
```

## Use the production Editful app

Plugin creators use the normally installed Editful desktop app. They do not
clone, build, or run the Editful application source.

First create one stable folder for unpacked development plugins:

```bash
mkdir -p "$HOME/Documents/Editful Plugins"
```

In Editful, open **Manage plugins**, choose **Plugins folder**, select that same
folder, and use **Reload Editful** when prompted. Then run the plugin watcher in
a separate terminal:

```bash
pnpm --dir examples/react-plugin dev --root "$HOME/Documents/Editful Plugins"
```

The tool creates `example-react-counter/` as a direct child of the selected
folder. The production app watches that folder and reloads validated plugin
builds automatically. A change that expands remote-media policy may require the
app reload offered by Editful.

`--root` must be the exact folder selected in Editful, not the plugin project
directory. See the [plugin tools documentation](packages/plugin-tools/README.md)
for the configuration and command contract.

## Repository boundary

This repository is intentionally safe to publish independently. CI rejects
private application-package imports, internal application paths, private
service endpoints, and symlinks. History was created fresh rather than copied
from the application repository.

## Status

The repository is private during extraction and release setup. It is designed
to become public without rewriting its history.

## License

[MIT](LICENSE)
