import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CURVES, PROFILE_BYTES, SCALES, Side, defaultProfile, deserializeProfile, keysNote, pack7, packedSize, serializeProfile, unpack7, velocityLut,
} from './protocol';

// written by the firmware's host tests (tests/host/run.sh)
const vectors = JSON.parse(readFileSync(new URL('../../tests/vectors/vectors.json', import.meta.url), 'utf8'));

describe('same bytes as the firmware', () => {
  it('profile size', () => expect(vectors.profileBytes).toBe(PROFILE_BYTES));
  it('default profiles', () => {
    expect(Array.from(serializeProfile(defaultProfile(Side.RIGHT)))).toEqual(vectors.defaultRight);
    expect(Array.from(serializeProfile(defaultProfile(Side.LEFT)))).toEqual(vectors.defaultLeft);
  });
  it('velocity curves', () => {
    const s = { ...defaultProfile(Side.RIGHT).sens, ...vectors.lutSens };
    CURVES.forEach((_, c) => expect(velocityLut({ ...s, curve: c })).toEqual(vectors.luts[c]));
  });
  it('KEYS notes', () => {
    for (const [layout, rowStep, root, scale, octave, row, col, note, kind] of vectors.keys) {
      const l = { type: 2, channel: 0, layout, rowStep, rootColor: 0, scaleColor: 0, outColor: 0, pressedColor: 0 };
      expect(keysNote(l, root, SCALES[scale].mask, octave, row, col)).toEqual({ note, kind });
    }
  });
});

describe('packing and round trip', () => {
  it('pack7', () => {
    const b = Uint8Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 255);
    const p = pack7(b);
    expect(p.length).toBe(packedSize(300));
    expect(p.every((v) => v < 128)).toBe(true);
    expect(Array.from(unpack7(p))).toEqual(Array.from(b));
  });
  it('profile', () => {
    const p = defaultProfile(Side.LEFT);
    p.name = 'Drums';
    p.sens.curve = 7;
    const q = deserializeProfile(serializeProfile(p))!;
    expect(q).toEqual(p);
  });
});
