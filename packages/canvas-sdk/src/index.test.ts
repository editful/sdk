import { describe, expect, it } from 'vitest';
import { hexColor } from './index.js';

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
