---
'@editful/canvas-sdk': minor
---

Add `PluginRendererHost.live`, ephemeral state shared live with the board's
other clients and never saved, for showing an interaction such as a drag while
it happens. `publish(channel, value)` sets this client's JSON value (at most
1 KiB) or clears it with `null`; the host sends the latest value at most once
per frame. `subscribe(channel, listener)` reports each peer's value, and `null`
when the peer clears it, disconnects, or goes quiet for about two seconds.
Channels are scoped to the plugin. Absent on local-only documents and on hosts
that predate it.
