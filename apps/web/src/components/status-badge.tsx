import type { Tone } from '../lib/copy';

/** Shape plus word, so status never depends on colour alone. */
export function StatusIcon({ tone }: { tone: Tone }) {
  switch (tone) {
    case 'violation':
      return (
        <svg className="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <rect x="3.5" y="3.5" width="13" height="13" transform="rotate(45 10 10)" />
          <path d="M7 7l6 6M13 7l-6 6" />
        </svg>
      );
    case 'holds':
      return (
        <svg className="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M6.5 10.5l2.5 2.5 4.5-5" />
        </svg>
      );
    case 'inconclusive':
      return (
        <svg className="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 5.5v5l3 2" />
        </svg>
      );
    case 'invalid':
      return (
        <svg className="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M10 2.5l8 14H2z" />
          <path d="M10 8v4M10 14.2v.1" />
        </svg>
      );
  }
}

export function StatusBadge({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span className={`badge badge-${tone}`}>
      <StatusIcon tone={tone} />
      {children}
    </span>
  );
}
