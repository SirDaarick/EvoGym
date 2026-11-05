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
});
