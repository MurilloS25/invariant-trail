'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LESSONS, getLesson } from '../lib/lessons';
import type { Runner } from '../lib/runner';
import { LearnMode } from './learn';
import { MODE_EVENT } from './mode-link';
import { Workspace } from './workspace';

type Mode = 'learn' | 'sandbox';

interface Props {
  /** Test seam: replaces the worker-based runner. */
  runner?: Runner;
  /** Test seam: skip reading and writing the address bar and hash. */
  syncUrl?: boolean;
}

const TABS: Array<{ id: Mode; label: string; hint: string }> = [
  { id: 'learn', label: 'Learn', hint: 'Guided lessons' },
  { id: 'sandbox', label: 'Sandbox', hint: 'All the controls' },
];

/** Learn is the default. A link with sandbox settings, or `#sandbox`, opens the sandbox. */
export function AppShell({ runner, syncUrl = true }: Props) {
  const [mode, setMode] = useState<Mode>('learn');
  const [lessonId, setLessonId] = useState<string>((LESSONS[0] as { id: string }).id);
  /** True once the address bar has been read, so nothing overwrites a shared link before that. */
  const [resolved, setResolved] = useState(!syncUrl);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const openMode = useCallback((next: Mode, focusTab: boolean) => {
    setMode(next);
    requestAnimationFrame(() => {
      document.getElementById('practice')?.scrollIntoView?.({ block: 'start' });
      if (focusTab) tabRefs.current[TABS.findIndex((t) => t.id === next)]?.focus();
    });
  }, []);

  useEffect(() => {
    // Links from the page header and hero switch mode on every use, not only when the hash changes.
    const onMode = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === 'learn' || detail === 'sandbox') openMode(detail, true);
    };
    window.addEventListener(MODE_EVENT, onMode);
    return () => window.removeEventListener(MODE_EVENT, onMode);
  }, [openMode]);

  useEffect(() => {
    if (!syncUrl) return;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('lesson');
    const hash = window.location.hash;
    // Reading the address bar has to wait for the browser, so these are set after mount.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (requested && getLesson(requested)) setLessonId(requested);
    if (params.has('t') || hash === '#sandbox') setMode('sandbox');
    setResolved(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (hash === '#sandbox' || hash === '#learn')
      openMode(hash === '#sandbox' ? 'sandbox' : 'learn', false);

    const onHash = (): void => {
      if (window.location.hash === '#sandbox') openMode('sandbox', false);
      if (window.location.hash === '#learn') openMode('learn', false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [syncUrl, openMode]);

  useEffect(() => {
    if (!syncUrl || !resolved || mode !== 'learn') return;
    window.history.replaceState(null, '', `?lesson=${lessonId}`);
  }, [mode, lessonId, syncUrl, resolved]);

  const onTabKey = useCallback((event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    setMode((TABS[target] as { id: Mode }).id);
    tabRefs.current[target]?.focus();
  }, []);

  return (
    <section id="practice" className="practice" aria-labelledby="practice-heading">
      <h2 id="practice-heading">Practice</h2>
      <div className="tabs" role="tablist" aria-label="Practice mode">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={mode === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={mode === tab.id ? 0 : -1}
            className="tab"
            onClick={() => setMode(tab.id)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            <span className="tab-label">{tab.label}</span>
            <span className="tab-hint">{tab.hint}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id="panel-learn" aria-labelledby="tab-learn" hidden={mode !== 'learn'}>
        <LearnMode {...(runner ? { runner } : {})} lessonId={lessonId} onLesson={setLessonId} />
      </div>
      <div
        role="tabpanel"
        id="panel-sandbox"
        aria-labelledby="tab-sandbox"
        hidden={mode !== 'sandbox'}
      >
        <Workspace {...(runner ? { runner } : {})} syncUrl={syncUrl} active={mode === 'sandbox'} />
      </div>
    </section>
  );
}
