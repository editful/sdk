import { describe, expect, it } from 'vitest';
import { LineMarker, Primitive, encodeLineMarkers, hexColor } from './index.js';

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

describe('line primitives', () => {
  it('keeps the append-only primitive value aligned with the renderer', () => {
    expect(Primitive.Line).toBe(3);
  });

  it('encodes start and end markers independently', () => {
    expect(encodeLineMarkers(LineMarker.OpenArrow, LineMarker.SolidArrow)).toBe(9);
    expect(encodeLineMarkers(LineMarker.Cap, LineMarker.None)).toBe(3);
  });
});
