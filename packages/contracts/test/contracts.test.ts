import { describe, expect, it } from 'vitest';
import {
  clampLimits,
  decodeRequest,
  DEFAULT_LIMITS,
  encodeRequest,
  NO_FAULTS,
  parseExplorationRequest,
  REQUEST_VERSION,
  type ExplorationRequest,
} from '../src';

const sample: ExplorationRequest = {
  version: REQUEST_VERSION,
  templateId: 'booking-confirmation',
  invariantId: 'single-confirmation',
  design: { guard: 'conditional-write' },
  faults: { ...NO_FAULTS, duplicate: 2, delay: true, retry: 1 },
  limits: { maxDepth: 12, maxStates: 5000, maxBranching: 16 },
};
const defaults = { faults: NO_FAULTS, limits: DEFAULT_LIMITS };

describe('request schema', () => {
  it('accepts a valid request and rejects unknown keys at every level', () => {
    expect(parseExplorationRequest(sample).ok).toBe(true);
    expect(parseExplorationRequest({ ...sample, extra: true }).ok).toBe(false);
    expect(parseExplorationRequest({ ...sample, faults: { ...sample.faults, extra: 1 } }).ok).toBe(
      false,
    );
    expect(parseExplorationRequest({ ...sample, limits: { ...sample.limits, extra: 1 } }).ok).toBe(
      false,
    );
  });

  it('rejects out-of-range numbers, non-integers, and malformed identifiers', () => {
    expect(
      parseExplorationRequest({ ...sample, limits: { ...sample.limits, maxDepth: 41 } }).ok,
    ).toBe(false);
    expect(parseExplorationRequest({ ...sample, faults: { ...sample.faults, crash: 2 } }).ok).toBe(
      false,
    );
    expect(parseExplorationRequest({ ...sample, templateId: '../etc/passwd' }).ok).toBe(false);
    expect(parseExplorationRequest({ ...sample, invariantId: '<script>' }).ok).toBe(false);
    expect(parseExplorationRequest({ ...sample, design: { a: 'A'.repeat(5) } }).ok).toBe(false);
  });

  it('limits the number and size of issues it reports', () => {
    const result = parseExplorationRequest({ nonsense: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeLessThanOrEqual(10);
  });
});

describe('clampLimits', () => {
  it('clamps extremes and replaces non-numbers with defaults', () => {
    expect(clampLimits({ maxDepth: 1e9, maxStates: -5, maxBranching: Number.NaN })).toEqual({
      maxDepth: 40,
      maxStates: 100,
      maxBranching: DEFAULT_LIMITS.maxBranching,
    });
    expect(clampLimits({ maxDepth: 7.9 }).maxDepth).toBe(7);
  });
});

describe('URL round trip', () => {
  it('encodes deterministically and decodes to the same request', () => {
    const query = encodeRequest(sample);
    expect(encodeRequest(sample)).toBe(query);
    const decoded = decodeRequest(`?${query}`, defaults);
    expect(decoded).toEqual({ ok: true, value: sample });
  });

  it('does not depend on parameter order', () => {
    const shuffled = [...new URLSearchParams(encodeRequest(sample)).entries()].reverse();
    const query = new URLSearchParams(shuffled).toString();
    expect(decodeRequest(query, defaults)).toEqual({ ok: true, value: sample });
  });

  it('treats hostile input as data: unknown controls, bad values, oversize strings', () => {
    const base = encodeRequest(sample);
    const hostile = [
      `${base}&f.explode=1`,
      `${base}&l.everything=9`,
      `${base}&f.delay=maybe`,
      base.replace('f.duplicate=2', 'f.duplicate=-1'),
      base.replace('f.duplicate=2', 'f.duplicate=9999999'),
      base.replace('l.depth=12', 'l.depth=1e9'),
      base.replace('t=booking-confirmation', 't=%3Cimg%20onerror%3Dalert(1)%3E'),
      `${base}&d.__proto__=x`,
      `${base}&${'z'.repeat(2000)}=1`,
      '',
    ];
    for (const query of hostile) {
      expect(decodeRequest(query, defaults).ok, query.slice(0, 60)).toBe(false);
    }
  });

  it('ignores unrelated parameters', () => {
    expect(decodeRequest(`${encodeRequest(sample)}&utm_source=x`, defaults).ok).toBe(true);
  });
});
