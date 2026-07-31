# Editful Plugin SDK

The SDK is the public authoring contract for trusted local Editful plugins.
Plugins default-export `definePlugin({ register(context) { ... } })`.
Registration stays synchronous and transactional.

Schema-1 plugins can declare deterministic canvas node kinds. Schema-2 plugins
can additionally declare commands, paste/drop importers, semantic interaction
regions, trusted editor UI, and JSON-schema agent actions. Invocation contexts
expose bounded document transactions, stable selection/node ids, profile
settings and secret references, declared network access, policy-bound
remote-image dimension probing, and host services.

Agent action schemas use one authoritative, recursively bounded subset:
`type`, `enum`, `description`, object `properties`/`required`/
`additionalProperties`, array `items`/`minItems`/`maxItems`, string
`minLength`/`maxLength`, and numeric `minimum`/`maximum`. Registration rejects
other keywords so the desktop runtime and published MCP schema cannot disagree.

```ts
import { Primitive, definePlugin } from '@editful/plugin-sdk';

export default definePlugin({
  register(context) {
    const gauge = context.kind('acme:gauge');
    const level = gauge.field.f64('level', { default: 0.5 });
    const imageUrl = gauge.field.string('image-url');

    gauge.agent({ name: 'gauge' });
    gauge.pack((node, _services, out) => {
      out.quad(
        node.x,
        node.y,
        node.halfW * node.get(level),
        node.halfH,
        node.rotation,
        node.cornerRadius,
        node.strokeWidth,
        Primitive.RoundRect,
        node.fill,
        node.stroke,
      );
      if (node.get(imageUrl) !== '') {
        out.imageQuad(
          { url: node.get(imageUrl) },
          node.x,
          node.y,
          node.halfW,
          node.halfH,
          node.rotation,
        );
      }
    });
  },
});
```

`PrimitiveWriter.imageQuad` is the one image primitive. It accepts either the
legacy asset-id argument or `{ url }`. Remote URLs belong in plugin-declared
fields. Attribution is not part of the SDK's image or GL records: plugins own
any source metadata and render it with generic text and interaction regions.

Enabled plugins use an Obsidian-style trust model and are trusted local code.
The APIs stay narrow for compatibility, auditability, and defense in depth;
they are not a promise of hostile-code isolation. An `editor-ui` plugin may
mount plain HTML or a bundled React root in the `toolbar`, `left-sidebar`, or
`right-sidebar` surface and owns its cleanup. Editor mounts receive the same
undoable action context as commands. Editors are automatic by default, or can
declare `activation: 'manual'` and be opened with transient bounded state via
`context.editors.open(...)`. Node snapshots and transactions expose generic
paint and typography properties, so appearance editors do not require renderer
or controller access. The SDK deliberately exports no scene
store, mutable registry, numeric kind/field index, renderer internals, raw IPC,
Node, filesystem, shell, or subprocess API. Field handles are branded to their
declaring kind and candidate registry.

## Host notification tray

Commands, interactions, importers, and editor callbacks can publish bounded
text notices through their action context:

```ts
action.ui.notify({
  title: 'Photo added',
  message: 'Photo by A. Example on Unsplash',
  tone: 'success',
});
```

Supported tones are `info`, `success`, `warning`, and `error`. The host owns
the lower-left tray, stacking, timing, motion, accessibility, and dismissal.
Info, success, and warning notices leave automatically; errors remain until
the condition changes or the user dismisses them. A plugin cannot choose a
screen position, duration, HTML, action button, or non-dismissible state.

Use `progress(message)` for action-scoped indeterminate work. The host removes
that progress notice when the action settles. Use `error(message)` for a
dismissible persistent action failure. Notifications are transient profile UI:
they are not written to the board, synchronized, rendered by WebGL, or exposed
to agents.
