# React plugin example

This example demonstrates a manual right-sidebar editor built with React and a
toolbar command that opens it.

```bash
pnpm typecheck
pnpm check
pnpm build
pnpm pack
```

For live development, install the production Editful desktop app and select a
stable folder under **Manage plugins → Plugins folder**. Then pass that same
absolute folder to the watcher:

```bash
pnpm dev --root "$HOME/Documents/Editful Plugins"
```

The tool writes this plugin as a direct child of the selected folder, and
Editful watches for validated rebuilds.
