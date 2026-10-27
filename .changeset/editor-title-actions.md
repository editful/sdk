---
'@editful/canvas-sdk': minor
---

Pass editors their host chrome: `mount(container, context, chrome)` now
receives a `PluginEditorChrome` whose `titleActions` element sits at the end of
a sidebar editor's title row, for compact controls such as an add button.
Editful before 0.15 passes no chrome, so editors should fall back to their own
container.
