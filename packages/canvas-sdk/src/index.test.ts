import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type PluginLivePeer,
  type PluginRendererLive,
  type PluginRendererHost,
  LineMarker,
  Primitive,
  definePlugin,
  encodeLineMarkers,
  hexColor,
  type PackedNode,
  type PluginBackgroundCameraLimits,
  type PluginBackgroundStatus,
  type PluginBackgroundSurfaceContribution,
  type PluginEditorChrome,
  type PluginJson,
  type PluginRendererInstance,
  type PluginSurfaceEditorRequest,
  type PluginSurfaceMarquee,
  type PluginSurfaceMarqueePhase,
  type PluginSurfaceMarqueeResult,
  type PluginSurfacePoint,
} from './index.js';

describe('hexColor', () => {
  it('packs short, long, and alpha hex colors', () => {
    expect(hexColor('#fff')).toBe(0xffffffff);
    expect(hexColor('#1a7f37')).toBe(0xff377f1a);
    expect(hexColor('#11223344')).toBe(0x44332211);
  });

  it('rejects unsupported color strings', () => {
    expect(() => hexColor('red')).toThrow(/Unsupported hex color/);
    expect(() => hexColor('#ffff')).toThrow(/Unsupported hex color/);
  });
});

describe('board background authoring contract', () => {
  it('preserves contribution state types through handles and documents', () => {
    definePlugin({
      register(context) {
        const background = context.backgroundSurface<'fixture:source', {
          readonly schemaVersion: 1;
          readonly sourceId: string;
        }>({
          id: 'fixture:background',
          label: 'Fixture',
          stateSchema: {
            type: 'object',
            properties: {
              schemaVersion: { type: 'number' },
              sourceId: { type: 'string' },
            },
            required: ['schemaVersion', 'sourceId'],
            additionalProperties: false,
          },
          sourceKind: 'fixture:source',
          sourceNodeId: (state) => state.sourceId,
          pack: () => undefined,
        });
        context.command({
          id: 'fixture:expand',
          label: 'Expand',
          contextMenu: { target: 'selection' },
          background: { handle: background, status: 'vacant' },
          async run(action) {
            expectTypeOf(action.document.background(background)).toEqualTypeOf<
              PluginBackgroundStatus<{
                readonly schemaVersion: 1;
                readonly sourceId: string;
              }>
            >();
            action.document.transaction('Expand').claimBackground(background, {
              schemaVersion: 1,
              sourceId: '1:1',
            });
          },
        });
        context.editor({
          id: 'fixture:settings',
          label: 'Settings',
          surface: 'right-sidebar',
          activation: 'manual',
          background,
          mount: () => undefined,
        });
        context.editor({
          id: 'fixture:layers',
          label: 'Layers',
          surface: 'left-sidebar',
          mount(container, _action, chrome) {
            expectTypeOf(chrome).toEqualTypeOf<PluginEditorChrome | undefined>();
            expectTypeOf(chrome?.titleActions).toEqualTypeOf<HTMLElement | undefined>();
            const add = document.createElement('button');
            (chrome?.titleActions ?? container).append(add);
            return { dispose: () => add.remove() };
          },
        });
        context.migration({
          id: 'fixture:background-v1',
          run: () => Promise.resolve('unchanged'),
        });
      },
    });
  });
});

describe('board background camera limits', () => {
  it('reads limits from the typed source node and state', () => {
    definePlugin({
      register(context) {
        const source = context.kind('fixture:source');
        const baseZoom = source.field.f64('base-zoom', { default: 8 });
        const background = context.backgroundSurface<'fixture:source', {
          readonly sourceId: string;
        }>({
          id: 'fixture:background',
          label: 'Fixture',
          stateSchema: {
            type: 'object',
            properties: { sourceId: { type: 'string' } },
            required: ['sourceId'],
            additionalProperties: false,
          },
          sourceKind: 'fixture:source',
          sourceNodeId: (state) => state.sourceId,
          pack: () => undefined,
          camera(node, state) {
            expectTypeOf(node).toEqualTypeOf<PackedNode<'fixture:source'>>();
            expectTypeOf(state).toEqualTypeOf<{ readonly sourceId: string }>();
            return {
              minZoom: 2 ** -node.get(baseZoom),
              maxZoom: 2 ** (22 - node.get(baseZoom)),
            };
          },
        });
        void background;
      },
    });
    expectTypeOf<PluginBackgroundSurfaceContribution['camera']>().toEqualTypeOf<
      | ((source: PackedNode, state: PluginJson) => PluginBackgroundCameraLimits)
      | undefined
    >();
    expectTypeOf<PluginBackgroundCameraLimits>().toEqualTypeOf<{
      readonly minZoom?: number;
      readonly maxZoom?: number;
    }>();
  });
});

describe('surface marquee', () => {
  it('passes the marquee corners and returns an optional selection', () => {
    const renderer: PluginRendererInstance = {
      render: () => undefined,
      marquee(marquee) {
        expectTypeOf(marquee.corners).toEqualTypeOf<readonly [
          PluginSurfacePoint,
          PluginSurfacePoint,
          PluginSurfacePoint,
          PluginSurfacePoint,
        ]>();
        expectTypeOf(marquee.extend).toEqualTypeOf<boolean>();
        expectTypeOf(marquee.phase).toEqualTypeOf<PluginSurfaceMarqueePhase>();
        return marquee.extend || marquee.phase === 'cancel'
          ? null
          : { featureId: 'pin-1', editor: { editorId: 'fixture:feature', state: { ids: ['pin-1'] } } };
      },
      dispose: () => undefined,
    };
    const corners = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] as const;
    const marquee: PluginSurfaceMarquee = {
      phase: 'end', surfaceId: 's', nodeId: 'n', state: {}, corners, extend: false,
    };
    expect(renderer.marquee?.(marquee)).toEqual({
      featureId: 'pin-1',
      editor: { editorId: 'fixture:feature', state: { ids: ['pin-1'] } },
    });
    expect(renderer.marquee?.({ ...marquee, extend: true })).toBeNull();
    expect(renderer.marquee?.({ ...marquee, phase: 'cancel' })).toBeNull();
    expectTypeOf<PluginSurfaceMarqueePhase>().toEqualTypeOf<'move' | 'end' | 'cancel'>();
    expectTypeOf<PluginSurfaceMarqueeResult>().toEqualTypeOf<{
      readonly featureId: string;
      readonly editor?: PluginSurfaceEditorRequest;
    }>();
  });
});

describe('line primitives', () => {
  it('keeps the append-only primitive value aligned with the renderer', () => {
    expect(Primitive.Line).toBe(3);
  });

  it('encodes start and end markers independently', () => {
    expect(encodeLineMarkers(LineMarker.OpenArrow, LineMarker.SolidArrow)).toBe(9);
    expect(encodeLineMarkers(LineMarker.Cap, LineMarker.None)).toBe(3);
  });
});

describe('renderer live state', () => {
  it('publishes JSON values and reports peers, optionally', () => {
    expectTypeOf<PluginRendererHost['live']>().toEqualTypeOf<PluginRendererLive | undefined>();
    expectTypeOf<PluginRendererLive['publish']>().parameters.toEqualTypeOf<
      [channel: string, value: PluginJson | null]
    >();
    expectTypeOf<PluginLivePeer>().toEqualTypeOf<{
      readonly clientId: number;
      readonly name: string;
      readonly colour: string;
    }>();
    const seen: (PluginJson | null)[] = [];
    const live: PluginRendererLive = {
      publish: () => undefined,
      subscribe(_channel, listener) {
        listener({ clientId: 2, name: 'Ada', colour: '#ff0000' }, { ids: ['a'] });
        listener({ clientId: 2, name: 'Ada', colour: '#ff0000' }, null);
        return () => undefined;
      },
    };
    live.subscribe('drag', (_peer, value) => seen.push(value));
    expect(seen).toEqual([{ ids: ['a'] }, null]);
  });
});
