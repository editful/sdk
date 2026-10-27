---
'@editful/canvas-sdk': minor
---

Let a board background limit the canvas camera. A background surface
contribution may declare `camera(source, state)`, which reads the same source
node and state as `pack` and returns `PluginBackgroundCameraLimits`. Its
`minZoom`, in canvas zoom units, stops the user zooming further out while the
background is active; a map can use it to stop at the whole world. Editful
before 0.16 ignores it.
