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

## Canvas views

Use `kind.ui` for display UI. The host measures and paints the same view tree.
Text is display-only; commands and editor surfaces write its fields.

```ts
import { TextFont, definePlugin, hexColor } from '@editful/canvas-sdk';

export default definePlugin({
  register(context) {
    const card = context.kind('acme:card');
    const title = card.field.string('title');
    const ui = card.ui;

    card.view({
      root: ui.box({
        fill: 'node',
        padding: 20,
        child: ui.text(title, {
          font: {
            family: TextFont.Sans,
            size: 'node',
            weight: 'node',
            lineHeight: 'node',
          },
          color: hexColor('#f0f6fc'),
        }),
      }),
      width: { mode: 'user', min: 280 },
      height: { mode: 'fit-content' },
    });
  },
});
```

Primitives: `text`, `image`, `box`, `stack`, and `spacer`. Values may be
literals or field handles. Use `kind.pack()` instead when the kind needs custom
geometry. A kind registers `view` or `pack`, not both.

```ts
import { Primitive, definePlugin } from '@editful/canvas-sdk';

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

`Primitive.Line` draws a procedural straight line through `out.quad`. Pass
`encodeLineMarkers(start, end)` as the quad's `cornerRadius` value to select
`LineMarker.None`, `OpenArrow`, `SolidArrow`, or `Cap` independently at either
endpoint. A toolbar create contribution can opt into two-point placement with
`geometry: 'line'`; the host stores the result as centre, length, and rotation.

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

## Board backgrounds

`context.backgroundSurface(...)` lets one node of a declared `sourceKind` fill
the board behind ordinary content while a plugin holds the board's background
lease. `pack(source, state, services, out)` emits the retained surface from
that source node.

A background can also limit the canvas camera while it is active. `camera`
reads the same source node and state as `pack`, and `minZoom` and `maxZoom`
are in canvas zoom units, CSS pixels per canvas unit. A map drawn at map zoom
`baseZoom + log2(canvasZoom)` shows the whole world, map zoom 0, at canvas
zoom `2 ** -baseZoom`, and map zoom 22 at `2 ** (22 - baseZoom)`:

```ts
context.backgroundSurface<'acme:map', { readonly sourceMapId: string }>({
  // id, label, stateSchema, sourceKind, sourceNodeId, pack...
  camera: (source) => ({
    minZoom: 2 ** -source.get(baseZoom),
    maxZoom: 2 ** (22 - source.get(baseZoom)),
  }),
});
```

Editful uses the higher of its own minimum and `minZoom`. `maxZoom` replaces
its maximum, so a background can zoom deeper than an ordinary board, up to
2^20 where rendering stays precise; the minimum never exceeds the maximum.
When the background becomes active, or a limit changes, Editful zooms a
camera outside the new range to its nearest end about the viewport centre.

### Moving this user's view

Changing a background's source node moves the background for everyone on the
board. To take one user to a place instead, such as a search result, an
action or editor moves that user's camera with `context.viewport`:

```ts
context.viewport?.moveTo({ x, y, zoom: 2 ** (15 - baseZoom) });
```

`x` and `y` are canvas coordinates and `zoom` is optional, in the same units
as `camera`. The view stays within the camera limits, and nothing is written
to the document. Hosts without the capability leave `viewport` undefined.

## Sharing an interaction live

`host.live` (absent on local-only documents and older hosts) shares what this
client is in the middle of doing, such as a feature being dragged, with the
board's other clients without saving it. Publish as often as you like; Editful
sends the latest value at most once a frame and repeats a value that stays set.
A peer's value reaches your listener with their name and presence colour, and
`null` when they clear it, leave, disconnect, or go quiet for about two
seconds. Commit the result through the document as usual when the interaction
ends.

```ts
host.live?.publish('drag', { ids, dx, dy });   // while dragging
host.live?.publish('drag', null);              // when it ends
const unsubscribe = host.live?.subscribe('drag', (peer, value) => {
  if (value === null) clearPreview(peer.clientId);
  else drawPreview(peer.clientId, peer.colour, value);
});
```

Channels are scoped to your plugin. A channel must be non-empty, and
`<pluginId>/<channel>` at most 128 UTF-8 bytes; a value's JSON at most 1 KiB.
Both methods throw `RangeError` otherwise.

## Selecting surface features with the marquee

A retained surface renderer, a board background's included, can take part in
the Select tool's marquee. While a marquee touches no canvas nodes, Editful
calls `marquee` on the surfaces under it, topmost first, with the marquee's
corners in surface-local CSS pixels and whether Shift or the primary modifier
extends the selection. `phase` is `move` on every pointer move, to highlight
what the marquee would select; `end` on release, to select it; and `cancel`
when the marquee is abandoned, touches nodes, or leaves the surface, to show
the prior selection again. The first surface to return a result wins, and
every other surface, including one above it that returned null, is told to
`cancel`; when none wins, each keeps what it showed. At `end`, the winner owns
the feature selection, as a pressed feature does, and Editful opens the
returned editor:

```ts
marquee({ phase, surfaceId, corners, extend }) {
  if (phase === 'cancel') return restoreSelection(surfaceId), null;
  const selected = featuresInside(surfaceId, corners, extend);
  if (phase === 'move') highlight(surfaceId, selected);
  else select(surfaceId, selected);
  if (selected.length === 0) return null;
  return {
    featureId: selected[0].id,
    editor: { editorId: 'acme:feature', state: { ids: selected.map(({ id }) => id) } },
  };
},
```

Editful before 0.16 ignores it.

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
