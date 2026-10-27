---
'@editful/plugin-tools': minor
---

`editful-plugin build`, `check`, and `dev` now also check the commands a plugin
registers and fail when a `toolbar.order` is not an integer from -1000 to 1000,
which Editful otherwise refuses when it loads the plugin. The bundle is
registered in a separate Node process with an empty environment under Node's
permission model, allowed only to read the bundle. Build results gain a
`warnings` list, reported by the CLI, for checks that cannot reach a verdict
outside Editful.
