import { FAULT_IDS, type FaultSettings } from './faults';
import type { Limits } from './limits';
import { parseExplorationRequest, REQUEST_VERSION } from './request';
import type { ExplorationRequest, ParseResult } from './request';

const MAX_QUERY_LENGTH = 1024;
const BOOLEAN_FAULTS = new Set<string>(['delay', 'reorder', 'concurrent']);
const LIMIT_KEYS: Record<string, keyof Limits> = {
  depth: 'maxDepth',
  states: 'maxStates',
  branching: 'maxBranching',
};

/** Serialises a request into a stable, compact query string (no leading `?`). */
export function encodeRequest(request: ExplorationRequest): string {
  const params = new URLSearchParams();
  params.set('t', request.templateId);
  params.set('i', request.invariantId);
  for (const key of Object.keys(request.design).sort()) {
    params.set(`d.${key}`, request.design[key] as string);
  }
  for (const fault of FAULT_IDS) {
    const value = request.faults[fault];
    params.set(`f.${fault}`, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  params.set('l.depth', String(request.limits.maxDepth));
  params.set('l.states', String(request.limits.maxStates));
  params.set('l.branching', String(request.limits.maxBranching));
  return params.toString();
}

export interface RequestDefaults {
  faults: FaultSettings;
  limits: Limits;
}

/**
 * Parses a query string as untrusted input. Unknown `f.` and `l.` keys are rejected and every
 * value is validated by the strict request schema; unrelated parameters are ignored. Faults and
 * limits that are absent fall back to `defaults`.
 */
export function decodeRequest(
  search: string,
  defaults: RequestDefaults,
): ParseResult<ExplorationRequest> {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (raw.length > MAX_QUERY_LENGTH) return { ok: false, issues: ['query string is too long'] };
  const params = new URLSearchParams(raw);
  const issues: string[] = [];
  const design: Record<string, string> = {};
  const faults: Record<string, number | boolean> = { ...defaults.faults };
  const limits: Record<string, number> = { ...defaults.limits };

  for (const [key, value] of params) {
    if (key.startsWith('d.')) {
      const name = key.slice(2);
      if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(name)) {
        issues.push('invalid design option name');
        continue;
      }
      design[name] = value;
    } else if (key.startsWith('f.')) {
      const name = key.slice(2);
      if (!(FAULT_IDS as readonly string[]).includes(name)) {
        issues.push(`unknown failure control: ${name.slice(0, 32)}`);
        continue;
      }
      if (BOOLEAN_FAULTS.has(name)) {
        if (value !== '0' && value !== '1') issues.push(`f.${name}: must be 0 or 1`);
        else faults[name] = value === '1';
      } else {
        faults[name] = /^\d{1,3}$/.test(value) ? Number(value) : Number.NaN;
      }
    } else if (key.startsWith('l.')) {
      const mapped = LIMIT_KEYS[key.slice(2)];
      if (!mapped) {
        issues.push(`unknown limit: ${key.slice(2, 34)}`);
        continue;
      }
      limits[mapped] = /^\d{1,7}$/.test(value) ? Number(value) : Number.NaN;
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  return parseExplorationRequest({
    version: REQUEST_VERSION,
    templateId: params.get('t') ?? '',
    invariantId: params.get('i') ?? '',
    design,
    faults,
    limits,
  });
}
