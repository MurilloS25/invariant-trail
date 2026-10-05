'use client';

import type { ReactNode } from 'react';

export const MODE_EVENT = 'invariant-trail:mode';

/** A real anchor (works without scripting) that also switches mode and scrolls, every time it is used. */
export function ModeLink({
  mode,
  className,
  children,
}: {
  mode: 'learn' | 'sandbox';
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={`#${mode}`}
      {...(className ? { className } : {})}
      onClick={(event) => {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: mode }));
      }}
    >
      {children}
    </a>
  );
}
