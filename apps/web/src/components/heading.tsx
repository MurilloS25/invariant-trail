import { createElement, type ReactNode, type Ref } from 'react';

/** A heading whose level is chosen by the surrounding page structure (h3 in the sandbox, h4 in a lesson). */
export function Heading({
  level,
  children,
  ...rest
}: {
  level: number;
  children: ReactNode;
  id?: string;
  className?: string;
  tabIndex?: number;
  ref?: Ref<HTMLHeadingElement>;
}) {
  return createElement(`h${Math.min(6, Math.max(1, level))}`, rest, children);
}
