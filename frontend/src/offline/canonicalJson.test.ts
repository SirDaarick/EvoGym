import { describe, expect, it } from 'vitest';
import vectors from '../../../docs/work-packages/contracts/F5-canonical-json-vectors.json';
import { canonicalJson, payloadHash } from './canonicalJson';

describe('canonicalJson', () => {
  for (const v of vectors.vectors) {
    it(`matches vector ${v.name}`, async () => {
      expect(canonicalJson(v.input)).toBe(v.canonical);
      expect(await payloadHash(v.input)).toBe(v.sha256);
    });
  }
  it('rejects floats, NaN, Infinity and undefined', () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow();
    expect(() => canonicalJson({ a: NaN })).toThrow();
    expect(() => canonicalJson({ a: Infinity })).toThrow();
    expect(() => canonicalJson({ a: undefined })).toThrow();
  });
  it('sorts keys and keeps raw non-ASCII', () => {
    expect(canonicalJson({ b: 'ñ', a: [1, { d: true, c: null }] })).toBe('{"a":[1,{"c":null,"d":true}],"b":"ñ"}');
  });
  it('sorts keys by Unicode code point like Python (astral after BMP private-use)', () => {
    // UTF-16 sort would put U+1F600 (D83D..) before U+FF5E; code point order puts it after.
    expect(canonicalJson({ '\u{1F600}': 1, '\uFF5E': 2 })).toBe('{"\uFF5E":2,"\u{1F600}":1}');
  });
  it('rejects unsafe integers', () => {
    expect(() => canonicalJson({ a: 2 ** 53 })).toThrow(/unsafe integer/);
    expect(canonicalJson({ a: 2 ** 53 - 1 })).toBe('{"a":9007199254740991}');
  });
});
