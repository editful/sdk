---
'@editful/canvas-sdk': minor
---

Let retained surfaces, board backgrounds included, take part in the Select
tool's marquee. A renderer may implement `marquee(marquee)`, which receives the
marquee's phase (`move` to highlight, `end` to select, `cancel` to restore),
its corners in surface-local CSS pixels and whether Shift or the primary
modifier extends the selection, and returns the selection's primary feature
and editor, or null. Editful asks surfaces only while the marquee touches no
canvas nodes, topmost first. Editful before 0.16 ignores it.
