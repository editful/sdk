---
'@editful/canvas-sdk': minor
---

Let a board background limit the canvas camera. A background surface
contribution may declare `camera(source, state)`, which reads the same source
node and state as `pack` and returns `PluginBackgroundCameraLimits`, in canvas
zoom units, that apply while the background is active. `minZoom` stops the user zooming
further out, so a map can stop at the whole world; `maxZoom` replaces the
host's maximum, so a map can zoom in to street detail beyond an ordinary
board's limit. Editful before 0.16 ignores it.
