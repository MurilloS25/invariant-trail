'use client';

import { useId, useState } from 'react';

interface Props {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  onCommit(value: number): void;
}

const format = (n: number): string => n.toLocaleString('en-US');

/** A number field that keeps a draft while typing and only commits a valid, in-range integer. */
export function LimitField({ label, help, value, min, max, onCommit }: Props) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);
  const trimmed = text.trim();
  const parsed = /^\d{1,7}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  const valid = Number.isInteger(parsed) && parsed >= min && parsed <= max;
  const showError = draft !== null && !valid;

  const commit = (): void => {
    if (draft !== null && valid) onCommit(parsed);
    setDraft(null);
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        aria-invalid={showError}
        aria-describedby={`${id}-help`}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = /^\d{1,7}$/.test(event.target.value.trim())
            ? Number(event.target.value.trim())
            : Number.NaN;
          if (Number.isInteger(next) && next >= min && next <= max) onCommit(next);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setDraft(null);
        }}
      />
      <p id={`${id}-help`} className={showError ? 'help help-error' : 'help'}>
        {showError ? `Enter a whole number from ${format(min)} to ${format(max)}.` : help}
      </p>
    </div>
  );
}
