import { describe, expect, it } from 'vitest';
import { CanonicalizationError, canonicalize, diffStates, stateDigest } from '../src';

describe('canonicalize', () => {
  it('is independent of object key insertion order at every depth', () => {
    const a = { b: 1, a: { y: [1, { q: 1, p: 2 }], x: null }, c: 'z' };
    const b = { c: 'z', a: { x: null, y: [1, { p: 2, q: 1 }] }, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('keeps array order significant and distinguishes types', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: '1' }));
    expect(canonicalize({ a: null })).not.toBe(canonicalize({}));
  });

  it('normalises negative zero and rejects non-JSON values', () => {
    expect(canonicalize(-0)).toBe('0');
    expect(() => canonicalize(Number.NaN)).toThrow(CanonicalizationError);
    expect(() => canonicalize(Infinity)).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalize(new Date(0))).toThrow(CanonicalizationError);
    expect(() => canonicalize({ f: () => 1 })).toThrow(CanonicalizationError);
    expect(() => canonicalize(1n)).toThrow(CanonicalizationError);
  });

  it('rejects cyclic or absurdly deep structures instead of overflowing the stack', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalize(cyclic)).toThrow(CanonicalizationError);
  });

  it('digests are stable, fixed-length display labels', () => {
    const key = canonicalize({ a: 1 });
    expect(stateDigest(key)).toBe(stateDigest(key));
    expect(stateDigest(key)).toMatch(/^[0-9a-f]{16}$/);
    expect(stateDigest(key)).not.toBe(stateDigest(canonicalize({ a: 2 })));
  });
});

describe('diffStates', () => {
  it('reports nested changes in path order', () => {
    const changes = diffStates(
      { db: { status: 'pending', n: 1 }, keep: true },
      { db: { n: 2, status: 'confirmed' }, keep: true },
    );
    expect(changes.map((c) => [c.path, c.op])).toEqual([
      ['db.n', 'changed'],
      ['db.status', 'changed'],
    ]);
  });

  it('treats arrays as multisets and reports additions and removals', () => {
    const changes = diffStates({ net: [{ m: 1 }, { m: 2 }] }, { net: [{ m: 2 }, { m: 3 }] });
    expect(changes).toEqual([
      { path: 'net[]', op: 'removed', before: { m: 1 } },
      { path: 'net[]', op: 'added', after: { m: 3 } },
    ]);
  });

  it('reports added and removed keys and nothing for equal states', () => {
    expect(diffStates({ a: 1 }, { a: 1 })).toEqual([]);
    expect(diffStates({ a: 1 }, { b: 2 }).map((c) => c.op)).toEqual(['removed', 'added']);
  });
});
