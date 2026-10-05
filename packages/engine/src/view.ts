import type { Counterexample } from '@invariant-trail/contracts';
import { canonicalize } from './canonical';
import type { Message, Obj, ProtocolState } from './kit/types';
import type { TemplateDef } from './templates';

export interface ViewRow {
  /** Stable identity used to match a row before and after a step. */
  id: string;
  label: string;
  value: string;
}

export type SectionId = 'clients' | 'network' | 'service' | 'store' | 'budget';

export interface ViewSection {
  id: SectionId;
  title: string;
  /** Shown when the section has no rows. */
  empty: string;
  rows: ViewRow[];
}

export type RowChange = 'unchanged' | 'changed' | 'added' | 'removed';

export interface DiffRow extends ViewRow {
  change: RowChange;
  previous?: string;
  /** True when the row is part of the evidence of the violated rule. */
  evidence: boolean;
}

export interface DiffSection extends Omit<ViewSection, 'rows'> {
  rows: DiffRow[];
}

const STATUS_TEXT: Record<string, string> = {
  idle: 'not started',
  waiting: 'waiting for an answer',
  done: 'finished',
  'gave-up': 'gave up',
};

const BUDGET_LABELS: Record<string, string> = {
  duplicate: 'Duplicate copies left',
  lostResponse: 'Answers that can still be lost',
  retry: 'Retries left',
  lateRetry: 'Late retries left',
  crash: 'Crashes left',
};

function formatLeaf(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value === null) return 'none';
  if (Array.isArray(value)) {
    return value.length === 0 ? 'none' : value.map((v) => formatLeaf(v)).join(', ');
  }
  if (typeof value === 'object') return canonicalize(value);
  return String(value);
}

function flatten(
  value: unknown,
  path: string,
  labels: Record<string, string>,
  out: ViewRow[],
  parentLabel?: string,
): void {
  const label = labels[path] ?? (parentLabel ? `${parentLabel} · ${path.split('.').pop()}` : path);
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  ) {
    const record = value as Obj;
    for (const key of Object.keys(record).sort()) {
      flatten(record[key], `${path}.${key}`, labels, out, labels[path] ?? parentLabel ?? path);
    }
    return;
  }
  const isEmptyObject =
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0;
  out.push({ id: path, label, value: isEmptyObject ? 'none' : formatLeaf(value) });
}

function numbered(rows: Array<{ key: string; label: string; value: string }>): ViewRow[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const count = (seen.get(row.key) ?? 0) + 1;
    seen.set(row.key, count);
    return {
      id: count === 1 ? row.key : `${row.key}#${count}`,
      label: row.label,
      value: row.value,
    };
  });
}

/** Turns a protocol state into labelled rows grouped by who owns the data. */
export function describeState(
  template: TemplateDef,
  design: Record<string, string>,
  state: ProtocolState,
): ViewSection[] {
  const spec = template.buildSpec(design);
  const clientLabel = (id: string): string => spec.clients.find((c) => c.id === id)?.label ?? id;

  const clients: ViewRow[] = spec.clients.map((client) => {
    const current = state.clients[client.id];
    const parts = [STATUS_TEXT[current?.status ?? 'idle'] ?? 'unknown'];
    if (current && current.attempts > 0) parts.push(`requests sent: ${current.attempts}`);
    if (current?.result) parts.push(`answer: ${current.result}`);
    return { id: `clients.${client.id}`, label: client.label, value: parts.join(', ') };
  });

  const messageText = (m: Message): string =>
    m.kind === 'request'
      ? `Request #${m.attempt} from ${clientLabel(m.client)}`
      : `Answer "${m.result}" for ${clientLabel(m.client)}`;
  const network = numbered(
    state.net.map((m) => ({
      key: `net.${canonicalize(m)}`,
      label: messageText(m),
      value: 'in flight',
    })),
  );

  const service = numbered(
    state.handlers.map((h) => {
      const step = spec.operations[h.op]?.steps[h.step];
      return {
        key: `handlers.${canonicalize(h)}`,
        label: `Working on ${clientLabel(h.client)}'s request #${h.attempt}`,
        value: step ? `next step: ${step.name}` : 'finishing',
      };
    }),
  );

  const store: ViewRow[] = [];
  const db = state.db;
  for (const key of Object.keys(db).sort()) {
    flatten(db[key], `db.${key}`, template.dbLabels, store);
  }

  const budget: ViewRow[] = Object.keys(BUDGET_LABELS).map((name) => ({
    id: `budget.${name}`,
    label: BUDGET_LABELS[name] as string,
    value: String(state.budget[name as keyof ProtocolState['budget']]),
  }));

  return [
    { id: 'clients', title: 'Who is waiting', empty: '', rows: clients },
    { id: 'network', title: 'In flight', empty: 'Nothing is in flight.', rows: network },
    { id: 'service', title: 'Service is working on', empty: 'The service is idle.', rows: service },
    { id: 'store', title: 'Stored data', empty: '', rows: store },
    { id: 'budget', title: 'Failures still possible', empty: '', rows: budget },
  ];
}

function isEvidence(rowId: string, paths: string[]): boolean {
  return paths.some((p) => rowId === p || rowId.startsWith(`${p}.`) || p.startsWith(`${rowId}.`));
}

/** Compares two views row by row. Removed rows are kept so a step's effect stays visible. */
export function diffViews(
  before: ViewSection[],
  after: ViewSection[],
  evidencePaths: string[] = [],
): DiffSection[] {
  return after.map((section) => {
    const previous = before.find((s) => s.id === section.id);
    const old = new Map((previous?.rows ?? []).map((row) => [row.id, row]));
    const rows: DiffRow[] = section.rows.map((row) => {
      const was = old.get(row.id);
      old.delete(row.id);
      const evidence = isEvidence(row.id, evidencePaths);
      if (!was) return { ...row, change: 'added', evidence };
      if (was.value !== row.value) {
        return { ...row, change: 'changed', previous: was.value, evidence };
      }
      return { ...row, change: 'unchanged', evidence };
    });
    for (const gone of old.values()) {
      rows.push({
        ...gone,
        change: 'removed',
        previous: gone.value,
        value: 'gone',
        evidence: isEvidence(gone.id, evidencePaths),
      });
    }
    return { id: section.id, title: section.title, empty: section.empty, rows };
  });
}

export interface CauseEntry {
  stepIndex: number;
  label: string;
  rows: Array<{ label: string; previous?: string; value: string }>;
}

/**
 * Lists, step by step, how the data named by the violation evidence changed. This is the causal
 * path: the steps that did not touch the evidence are omitted.
 */
export function explainCounterexample(
  template: TemplateDef,
  design: Record<string, string>,
  counterexample: Counterexample,
): CauseEntry[] {
  const entries: CauseEntry[] = [];
  for (const step of counterexample.steps) {
    const before = describeState(template, design, step.before as unknown as ProtocolState);
    const after = describeState(template, design, step.after as unknown as ProtocolState);
    const rows = diffViews(before, after, counterexample.violation.paths)
      .flatMap((section) => section.rows)
      .filter((row) => row.evidence && row.change !== 'unchanged')
      .map((row) => {
        const entry: { label: string; previous?: string; value: string } = {
          label: row.label,
          value: row.value,
        };
        if (row.previous !== undefined) entry.previous = row.previous;
        return entry;
      });
    if (rows.length > 0) {
      entries.push({ stepIndex: step.index, label: step.transition.label, rows });
    }
  }
  return entries;
}
