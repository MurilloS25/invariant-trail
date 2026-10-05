import type { Json, StateChange, Violation } from '@invariant-trail/contracts';
import { canonicalize } from './canonical';

function isRecord(value: Json): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diffInto(
  before: Json | undefined,
  after: Json | undefined,
  path: string,
  out: StateChange[],
): void {
  if (before === undefined && after === undefined) return;
  if (before === undefined) {
    out.push({ path, op: 'added', after: after as Json });
    return;
  }
  if (after === undefined) {
    out.push({ path, op: 'removed', before });
    return;
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      diffInto(before[key], after[key], path ? `${path}.${key}` : key, out);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    // Arrays are compared as multisets so that queue/bag changes read as additions and removals.
    const remaining = new Map<string, number>();
    for (const item of before) {
      const key = canonicalize(item);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
    const added: Json[] = [];
    for (const item of after) {
      const key = canonicalize(item);
      const count = remaining.get(key) ?? 0;
      if (count > 0) remaining.set(key, count - 1);
      else added.push(item);
    }
    const removed: Json[] = [];
    for (const item of before) {
      const key = canonicalize(item);
      const count = remaining.get(key) ?? 0;
      if (count > 0) {
        remaining.set(key, count - 1);
        removed.push(item);
      }
    }
    for (const item of removed) out.push({ path: `${path}[]`, op: 'removed', before: item });
    for (const item of added) out.push({ path: `${path}[]`, op: 'added', after: item });
    return;
  }
  if (canonicalize(before) !== canonicalize(after)) {
    out.push({ path, op: 'changed', before, after });
  }
}

/** Deterministic structural diff between two states, ordered by path. */
export function diffStates(before: Json, after: Json): StateChange[] {
  const out: StateChange[] = [];
  diffInto(before, after, '', out);
  return out;
}

function related(changePath: string, evidencePath: string): boolean {
  const a = changePath.replace(/\[\]$/, '');
  const b = evidencePath.replace(/\[\]$/, '');
  return (
    a === b ||
    a.startsWith(`${b}.`) ||
    a.startsWith(`${b}[`) ||
    b.startsWith(`${a}.`) ||
    b.startsWith(`${a}[`)
  );
}

/** True when any change touches (or is nested in, or contains) a path named by the violation. */
export function touchesEvidence(changes: StateChange[], violation: Violation): boolean {
  return changes.some((change) => violation.paths.some((path) => related(change.path, path)));
}
