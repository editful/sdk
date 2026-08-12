import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  LineMarker,
  Primitive,
  definePlugin,
  encodeLineMarkers,
  hexColor,
  type PluginBackgroundStatus,
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
        context.migration({
          id: 'fixture:background-v1',
          run: () => Promise.resolve('unchanged'),
        });
      },
    });
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
