import { z } from 'zod';
import { FAULT_BOUNDS, type FaultSettings } from './faults';
import { LIMIT_BOUNDS, type Limits } from './limits';

export const REQUEST_VERSION = 1;

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const id = z.string().regex(ID, 'must be a lowercase identifier');

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const faultsSchema = z
  .object({
    duplicate: int(FAULT_BOUNDS.duplicate.min, FAULT_BOUNDS.duplicate.max),
    lostResponse: int(FAULT_BOUNDS.lostResponse.min, FAULT_BOUNDS.lostResponse.max),
    delay: z.boolean(),
    reorder: z.boolean(),
    concurrent: z.boolean(),
    crash: int(FAULT_BOUNDS.crash.min, FAULT_BOUNDS.crash.max),
    retry: int(FAULT_BOUNDS.retry.min, FAULT_BOUNDS.retry.max),
    lateRetry: int(FAULT_BOUNDS.lateRetry.min, FAULT_BOUNDS.lateRetry.max),
  })
  .strict();

const limitsSchema = z
  .object({
    maxDepth: int(LIMIT_BOUNDS.maxDepth.min, LIMIT_BOUNDS.maxDepth.max),
    maxStates: int(LIMIT_BOUNDS.maxStates.min, LIMIT_BOUNDS.maxStates.max),
    maxBranching: int(LIMIT_BOUNDS.maxBranching.min, LIMIT_BOUNDS.maxBranching.max),
  })
  .strict();

export const explorationRequestSchema = z
  .object({
    version: z.literal(REQUEST_VERSION),
    templateId: id,
    invariantId: id,
    /** Design choices of the template, validated against the template's allowlist by the engine. */
    design: z.record(id, id).refine((d) => Object.keys(d).length <= 8, 'too many design options'),
    faults: faultsSchema,
    limits: limitsSchema,
  })
  .strict();

export interface ExplorationRequest {
  version: typeof REQUEST_VERSION;
  templateId: string;
  invariantId: string;
  design: Record<string, string>;
  faults: FaultSettings;
  limits: Limits;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

/** Zod drops some prototype-polluting keys silently; reject them explicitly instead. */
function forbiddenKeyIssues(input: unknown): string[] {
  const issues: string[] = [];
  const visit = (value: unknown, path: string, depth: number): void => {
    if (typeof value !== 'object' || value === null || depth > 3) return;
    for (const name of Object.getOwnPropertyNames(value)) {
      if (FORBIDDEN_KEYS.includes(name)) issues.push(`${path || 'request'}: forbidden key`);
      else
        visit((value as Record<string, unknown>)[name], path ? `${path}.${name}` : name, depth + 1);
    }
  };
  visit(input, '', 0);
  return issues;
}

/** Validates untrusted input against the strict request schema. Unknown keys are rejected. */
export function parseExplorationRequest(input: unknown): ParseResult<ExplorationRequest> {
  const forbidden = forbiddenKeyIssues(input);
  if (forbidden.length > 0) return { ok: false, issues: forbidden.slice(0, 10) };
  const result = explorationRequestSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data as ExplorationRequest };
  return {
    ok: false,
    issues: result.error.issues.slice(0, 10).map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    }),
  };
}
