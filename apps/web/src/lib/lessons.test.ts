import { runExploration, getTemplate } from '@invariant-trail/engine';
import { describe, expect, it } from 'vitest';
import { GLOSSARY, LESSONS, lessonRequest } from './lessons';

describe.each(LESSONS.map((l) => [l.id, l] as const))('lesson %s', (_id, lesson) => {
  const template = getTemplate(lesson.templateId)!;

  it('points at a real workflow, rule and design choices', () => {
    expect(template).toBeDefined();
    expect(template.invariants.map((i) => i.id)).toContain(lesson.invariantId);
    for (const [key, value] of Object.entries({
      ...lesson.design,
      ...lesson.protectedDesign.design,
    })) {
      const option = template.designOptions.find((o) => o.id === key);
      expect(option?.choices.map((c) => c.id)).toContain(value);
    }
    for (const term of lesson.terms) expect(GLOSSARY[term]).toBeDefined();
    expect(GLOSSARY[lesson.concept]).toBeDefined();
  });

  it('breaks the rule with the unprotected design', () => {
    const outcome = runExploration(lessonRequest(lesson));
    expect(outcome.status).toBe('violated');
    if (outcome.status === 'violated') {
      expect(outcome.counterexample.steps.length).toBeGreaterThan(0);
      expect(outcome.counterexample.steps.length).toBeLessThanOrEqual(12);
    }
  });

  it('finds no violation, in the whole model, with the protected design and the same failures', () => {
    const outcome = runExploration(lessonRequest(lesson, true));
    expect(outcome.status).toBe('bounded-safe');
    if (outcome.status === 'bounded-safe') expect(outcome.complete).toBe(true);
  });
});

describe('lesson copy', () => {
  it('never claims a fix works universally', () => {
    const text = JSON.stringify(LESSONS).toLowerCase();
    for (const banned of [
      'guarantee',
      'always fixes',
      'proves',
      'proved',
      'bulletproof',
      'completely safe',
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  it('has unique ids and covers all four workflows', () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    expect(new Set(LESSONS.map((l) => l.templateId)).size).toBe(4);
  });
});
