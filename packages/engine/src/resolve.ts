import {
  parseExplorationRequest,
  type ExplorationOutcome,
  type ExplorationRequest,
} from '@invariant-trail/contracts';
import {
  exploreAsync,
  explore,
  invalidOutcome,
  type ExploreAsyncOptions,
  type ExploreOptions,
} from './explorer';
import { buildModel } from './kit/build';
import type { InvariantDef, ProtocolState } from './kit/types';
import type { Model } from './model';
import { getTemplate } from './templates';
import type { TemplateDef } from './templates';

export interface ResolvedRequest {
  request: ExplorationRequest;
  template: TemplateDef;
  invariant: InvariantDef;
  /** Design choices with defaults filled in. */
  design: Record<string, string>;
  model: Model<ProtocolState>;
}

export type ResolveResult = { ok: true; value: ResolvedRequest } | { ok: false; issues: string[] };

/** Maps allowlisted identifiers onto a model. Anything not on the allowlists is rejected. */
export function resolveRequest(request: ExplorationRequest): ResolveResult {
  const template = getTemplate(request.templateId);
  if (!template) return { ok: false, issues: ['templateId: unknown workflow'] };
  const invariant = template.invariants.find((i) => i.id === request.invariantId);
  if (!invariant) return { ok: false, issues: ['invariantId: unknown rule for this workflow'] };

  const issues: string[] = [];
  const design: Record<string, string> = {};
  for (const option of template.designOptions) {
    design[option.id] = option.defaultChoice;
  }
  for (const [key, value] of Object.entries(request.design)) {
    const option = template.designOptions.find((o) => o.id === key);
    if (!option) issues.push(`design.${key}: unknown design option`);
    else if (!option.choices.some((c) => c.id === value)) {
      issues.push(`design.${key}: unknown choice`);
    } else design[key] = value;
  }
  if (issues.length > 0) return { ok: false, issues };

  const model = buildModel(template.buildSpec(design), request.faults, invariant);
  return { ok: true, value: { request, template, invariant, design, model } };
}

function prepare(
  input: unknown,
): { ok: true; value: ResolvedRequest } | { ok: false; outcome: ExplorationOutcome } {
  const parsed = parseExplorationRequest(input);
  if (!parsed.ok) return { ok: false, outcome: invalidOutcome(parsed.issues) };
  let resolved: ResolveResult;
  try {
    resolved = resolveRequest(parsed.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, outcome: invalidOutcome([`model error: ${message}`.slice(0, 300)]) };
  }
  if (!resolved.ok)
    return { ok: false, outcome: invalidOutcome(resolved.issues, parsed.value.limits) };
  return { ok: true, value: resolved.value };
}

/** Validates untrusted input, resolves it through the allowlists, and explores synchronously. */
export function runExploration(input: unknown, options?: ExploreOptions): ExplorationOutcome {
  const prepared = prepare(input);
  if (!prepared.ok) return prepared.outcome;
  const { model, request } = prepared.value;
  return explore(model, request.limits, options);
}

/** Same as `runExploration`, but chunked so that a host can cancel between chunks. */
export async function runExplorationAsync(
  input: unknown,
  options?: ExploreAsyncOptions,
): Promise<ExplorationOutcome> {
  const prepared = prepare(input);
  if (!prepared.ok) return prepared.outcome;
  const { model, request } = prepared.value;
  return exploreAsync(model, request.limits, options);
}
