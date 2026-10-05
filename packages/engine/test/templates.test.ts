import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  REQUEST_VERSION,
  type ExplorationRequest,
  type FaultSettings,
  type Limits,
} from '@invariant-trail/contracts';
import {
  replayTrace,
  resolveRequest,
  runExploration,
  TEMPLATES,
  type Model,
  type TemplateDef,
} from '../src';
import type { Json } from '@invariant-trail/contracts';

function requestFor(
  template: TemplateDef,
  invariantId: string,
  design: Record<string, string>,
  faults: FaultSettings,
  limits: Limits = DEFAULT_LIMITS,
): ExplorationRequest {
  return { version: REQUEST_VERSION, templateId: template.id, invariantId, design, faults, limits };
}

function modelOf(request: ExplorationRequest): Model {
  const resolved = resolveRequest(request);
  if (!resolved.ok) throw new Error(resolved.issues.join('; '));
  return resolved.value.model as unknown as Model;
}

/** Independent reference: iterative deepening DFS with no deduplication at all. */
function shortestByDeepening(model: Model, maxDepth: number): number | null {
  const search = (state: Json, depth: number, limit: number): boolean => {
    if (model.invariant(state)) return true;
    if (depth === limit) return false;
    return model.successors(state).some((t) => search(t.next, depth + 1, limit));
  };
  for (let limit = 0; limit <= maxDepth; limit++) {
    if (search(model.initial, 0, limit)) return limit;
  }
  return null;
}

describe.each(TEMPLATES.map((t) => [t.id, t] as const))('template %s', (_id, template) => {
  it('ships a safe preset, an unsafe preset, and at least two rules', () => {
    expect(template.presets.some((p) => p.expect.status === 'bounded-safe')).toBe(true);
    expect(template.presets.some((p) => p.expect.status === 'violated')).toBe(true);
    expect(template.invariants.length).toBeGreaterThanOrEqual(2);
  });

  it('uses only allowlisted design values in its presets', () => {
    for (const preset of template.presets) {
      for (const [key, value] of Object.entries(preset.design)) {
        const option = template.designOptions.find((o) => o.id === key);
        expect(option, `${preset.id}: ${key}`).toBeDefined();
        expect(option?.choices.map((c) => c.id)).toContain(value);
      }
      expect(template.invariants.map((i) => i.id)).toContain(preset.invariantId);
    }
  });

  describe.each(template.presets.map((p) => [p.id, p] as const))('preset %s', (_pid, preset) => {
    const request = requestFor(
      template,
      preset.invariantId,
      preset.design,
      preset.faults,
      preset.limits ?? DEFAULT_LIMITS,
    );

    it(`matches its documented outcome (${preset.expect.status})`, () => {
      const outcome = runExploration(request);
      expect(outcome.status).toBe(preset.expect.status);
      if (outcome.status === 'violated') {
        expect(outcome.counterexample.steps).toHaveLength(preset.expect.shortest as number);
        expect(outcome.minimalInModel).toBe(true);
        expect(outcome.counterexample.violation.message.length).toBeGreaterThan(0);
        expect(outcome.counterexample.steps.some((s) => s.contributes)).toBe(true);
      }
      if (outcome.status === 'bounded-safe') {
        expect(outcome.complete).toBe(true);
        expect(outcome.limitsHit).toEqual([]);
      }
    });

    it('is deterministic and its counterexample replays from the initial state', () => {
      const a = runExploration(request);
      const b = runExploration(request);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      if (a.status === 'violated') {
        const replay = replayTrace(modelOf(request), a.counterexample);
        expect(replay.problems).toEqual([]);
        expect(replay.ok).toBe(true);
      }
    });

    if (preset.expect.status === 'violated' && (preset.expect.shortest ?? 99) <= 8) {
      it('is minimal: iterative deepening without deduplication finds no shorter violation', () => {
        const shortest = shortestByDeepening(modelOf(request), preset.expect.shortest as number);
        expect(shortest).toBe(preset.expect.shortest);
      });
    }
  });
});

describe('every rule can actually be broken and has a safe design', () => {
  it('each rule is the target of at least one violated preset', () => {
    for (const template of TEMPLATES) {
      for (const invariant of template.invariants) {
        const violated = template.presets.some(
          (p) => p.invariantId === invariant.id && p.expect.status === 'violated',
        );
        expect(violated, `${template.id}/${invariant.id}`).toBe(true);
      }
    }
  });

  it('each rule holds, completely, for the safe design under broad failures', () => {
    for (const template of TEMPLATES) {
      const safe = template.presets.find((p) => p.expect.status === 'bounded-safe')!;
      for (const invariant of template.invariants) {
        const outcome = runExploration(
          requestFor(
            template,
            invariant.id,
            safe.design,
            safe.faults,
            safe.limits ?? DEFAULT_LIMITS,
          ),
        );
        expect(outcome.status, `${template.id}/${invariant.id}`).toBe('bounded-safe');
      }
    }
  });
});

describe('failure combinations', () => {
  const faultsArb: fc.Arbitrary<FaultSettings> = fc.record({
    duplicate: fc.integer({ min: 0, max: 1 }),
    lostResponse: fc.integer({ min: 0, max: 1 }),
    delay: fc.boolean(),
    reorder: fc.boolean(),
    concurrent: fc.boolean(),
    crash: fc.integer({ min: 0, max: 1 }),
    retry: fc.integer({ min: 0, max: 1 }),
    lateRetry: fc.integer({ min: 0, max: 1 }),
  });
  const small: Limits = { maxDepth: 40, maxStates: 6000, maxBranching: 64 };

  it('adding failures never hides a violation that a subset of them exposes', () => {
    const unsafe = TEMPLATES.map((t) => {
      const preset = t.presets.find((p) => p.expect.status === 'violated')!;
      return { template: t, preset };
    });
    fc.assert(
      fc.property(fc.constantFrom(...unsafe), faultsArb, faultsArb, (entry, a, b) => {
        const union: FaultSettings = {
          duplicate: Math.max(a.duplicate, b.duplicate),
          lostResponse: Math.max(a.lostResponse, b.lostResponse),
          delay: a.delay || b.delay,
          reorder: a.reorder || b.reorder,
          concurrent: a.concurrent || b.concurrent,
          crash: Math.max(a.crash, b.crash),
          retry: Math.max(a.retry, b.retry),
          lateRetry: Math.max(a.lateRetry, b.lateRetry),
        };
        const { template, preset } = entry;
        const run = (faults: FaultSettings) =>
          runExploration(requestFor(template, preset.invariantId, preset.design, faults, small));
        const small1 = run(a);
        const big = run(union);
        if (small1.status === 'violated' && big.status !== 'exhausted') {
          expect(big.status).toBe('violated');
        }
        if (big.status === 'violated') {
          expect(JSON.stringify(run(union))).toBe(JSON.stringify(big));
        }
      }),
      { numRuns: 24 },
    );
  });
});

describe('request validation', () => {
  const base = requestFor(
    TEMPLATES[0]!,
    'single-confirmation',
    { guard: 'none' },
    {
      duplicate: 0,
      lostResponse: 0,
      delay: false,
      reorder: false,
      concurrent: false,
      crash: 0,
      retry: 0,
      lateRetry: 0,
    },
  );

  it('rejects unknown workflows, rules, design options and choices', () => {
    for (const bad of [
      { ...base, templateId: 'drop-tables' },
      { ...base, invariantId: 'nope' },
      { ...base, design: { guard: 'eval' } },
      { ...base, design: { surprise: 'none' } },
    ]) {
      expect(runExploration(bad).status).toBe('invalid');
    }
  });

  it('rejects unknown fields, bad types, extreme limits, and prototype-pollution keys', () => {
    const polluted = JSON.parse('{"__proto__":"x"}') as Record<string, string>;
    for (const bad of [
      { ...base, extra: 1 },
      { ...base, faults: { ...base.faults, duplicate: 3 } },
      { ...base, faults: { ...base.faults, duplicate: 1.5 } },
      { ...base, faults: { ...base.faults, delay: 'yes' } },
      { ...base, faults: { ...base.faults, surprise: 1 } },
      { ...base, limits: { ...base.limits, maxStates: 10 ** 9 } },
      { ...base, limits: { ...base.limits, maxDepth: -1 } },
      { ...base, limits: { ...base.limits, maxBranching: Number.NaN } },
      { ...base, version: 2 },
      { ...base, design: polluted },
      { ...base, design: { guard: 'x'.repeat(100) } },
      null,
      'string',
      [],
    ]) {
      const outcome = runExploration(bad);
      expect(outcome.status).toBe('invalid');
      expect(outcome.stats.statesDiscovered).toBe(0);
    }
  });

  it('fills in default design choices for omitted options', () => {
    const resolved = resolveRequest({ ...base, design: {} });
    expect(resolved.ok && resolved.value.design).toEqual({ guard: 'none' });
  });
});
