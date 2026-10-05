'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LESSONS, getLesson } from '../lib/lessons';
import type { Runner } from '../lib/runner';
import { LearnMode } from './learn';
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
  const ready = useRef(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!syncUrl) {
      ready.current = true;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('lesson');
    // Reading the address bar has to wait for the browser, so these are set after mount.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (requested && getLesson(requested)) setLessonId(requested);
    if (params.has('t') || window.location.hash === '#sandbox') setMode('sandbox');
    /* eslint-enable react-hooks/set-state-in-effect */
    ready.current = true;

    const onHash = (): void => {
      if (window.location.hash === '#sandbox') setMode('sandbox');
      if (window.location.hash === '#learn') setMode('learn');
      if (window.location.hash === '#sandbox' || window.location.hash === '#learn') {
        requestAnimationFrame(() =>
          document
            .getElementById(window.location.hash === '#sandbox' ? 'panel-sandbox' : 'panel-learn')
            ?.scrollIntoView({ block: 'start' }),
        );
      }
    };
    window.addEventListener('hashchange', onHash);
    if (window.location.hash === '#learn') setMode('learn');
    return () => window.removeEventListener('hashchange', onHash);
  }, [syncUrl]);

  useEffect(() => {
    if (!syncUrl || !ready.current || mode !== 'learn') return;
    window.history.replaceState(null, '', `?lesson=${lessonId}`);
  }, [mode, lessonId, syncUrl]);

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
