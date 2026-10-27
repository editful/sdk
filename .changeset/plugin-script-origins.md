---
'@editful/plugin-artifact': minor
'@editful/plugin-tools': minor
---

Let plugins declare external script origins. Schema-2 manifests accept up to
four `scripts: [{ origin, purpose }]` entries under the new `external-scripts`
capability, for vendor libraries such as Google's Maps JavaScript API that must
load from their own origin. Each origin must be an exact HTTPS origin that is
also declared in `network`. `definePluginConfig` accepts `scripts`, and builds
omit the field when it is empty so other plugins stay loadable by older
Editful releases.

