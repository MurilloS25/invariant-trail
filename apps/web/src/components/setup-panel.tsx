'use client';

/* The rule cannot see text inside nested spans: each label wraps its input and a text span. */
/* eslint-disable jsx-a11y/label-has-associated-control */

import { LIMIT_BOUNDS, type FaultSettings } from '@invariant-trail/contracts';
import { getTemplate, TEMPLATES, type Preset, type TemplateDef } from '@invariant-trail/engine';
import { useState, type Dispatch } from 'react';
import { FAULT_CONTROLS } from '../lib/faults-meta';
import type { Action, Config, RunState } from '../lib/workspace-state';
import { LimitField } from './limit-field';

interface Props {
  config: Config;
  run: RunState;
  dispatch: Dispatch<Action>;
  onExplore(): void;
  onCancel(): void;
}

const PRESET_KIND: Record<Preset['expect']['status'], string> = {
  violated: 'Breaks the rule',
  'bounded-safe': 'Holds within its limits',
  exhausted: 'Runs out of budget',
};

function samePreset(config: Config, preset: Preset): boolean {
  return (
    config.invariantId === preset.invariantId &&
    JSON.stringify(config.design) === JSON.stringify(preset.design) &&
    JSON.stringify(config.faults) === JSON.stringify(preset.faults)
  );
}

function FaultControlRow({
  control,
  faults,
  dispatch,
}: {
  control: (typeof FAULT_CONTROLS)[number];
  faults: FaultSettings;
  dispatch: Dispatch<Action>;
}) {
  const value = faults[control.id];
  const nameId = `fault-${control.id}`;
  if (control.kind === 'switch') {
    return (
      <div className="fault">
        <label className="switch" htmlFor={nameId}>
          <input
            id={nameId}
            type="checkbox"
            role="switch"
            checked={value === true}
            aria-describedby={`${nameId}-help`}
            onChange={(event) =>
              dispatch({ type: 'setFault', fault: control.id, value: event.target.checked })
            }
          />
          <span className="switch-track" aria-hidden="true" />
          <span className="fault-name">{control.label}</span>
          <span className="switch-state">{value ? 'On' : 'Off'}</span>
        </label>
        <p id={`${nameId}-help`} className="help">
          {control.help}
        </p>
      </div>
    );
  }
  const options = Array.from({ length: control.max + 1 }, (_, i) => i);
  return (
    <fieldset className="fault" aria-describedby={`${nameId}-help`}>
      <legend className="fault-name">{control.label}</legend>
      <div
        className="segmented"
        role="radiogroup"
        aria-label={`${control.label}: number of ${control.unit}`}
      >
        {options.map((option) => (
          <label key={option} className="segment">
            <input
              type="radio"
              name={nameId}
              value={option}
              checked={value === option}
              onChange={() => dispatch({ type: 'setFault', fault: control.id, value: option })}
            />
            <span>{option === 0 ? 'Off' : option}</span>
          </label>
        ))}
        <span className="segment-unit">{control.unit}</span>
      </div>
      <p id={`${nameId}-help`} className="help">
        {control.help}
      </p>
    </fieldset>
  );
}

/** Timing and crash controls: collapsed until needed, and open whenever one of them is on. */
function AdvancedFaults({
  faults,
  dispatch,
}: {
  faults: FaultSettings;
  dispatch: Dispatch<Action>;
}) {
  const advanced = FAULT_CONTROLS.filter((c) => c.group === 'advanced');
  const anyOn = advanced.some((c) => Boolean(faults[c.id]));
  const [open, setOpen] = useState(anyOn);
  return (
    <details
      className="advanced"
      open={open || anyOn}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Timing, ordering and crashes{anyOn ? ' (some on)' : ''}</summary>
      {advanced.map((control) => (
        <FaultControlRow key={control.id} control={control} faults={faults} dispatch={dispatch} />
      ))}
    </details>
  );
}

export function SetupPanel({ config, run, dispatch, onExplore, onCancel }: Props) {
  const template = getTemplate(config.templateId) as TemplateDef;
  const running = run.phase === 'running';
  const { limits } = config;

  return (
    <form
      className="setup"
      aria-label="Exploration settings"
      onSubmit={(event) => {
        event.preventDefault();
        onExplore();
      }}
    >
      <fieldset className="group">
        <legend>1. Workflow</legend>
        <div className="choice-list">
          {TEMPLATES.map((t) => (
            <label key={t.id} className="choice">
              <input
                type="radio"
                name="workflow"
                value={t.id}
                checked={config.templateId === t.id}
                onChange={() => dispatch({ type: 'selectTemplate', templateId: t.id })}
              />
              <span className="choice-body">
                <span className="choice-title">{t.title}</span>
                <span className="choice-help">{t.tagline}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <section className="group" aria-labelledby="presets-heading">
        <h3 id="presets-heading" className="group-title">
          Start from an example
        </h3>
        <ul className="preset-list">
          {template.presets.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                className="preset"
                aria-pressed={samePreset(config, preset)}
                onClick={() => dispatch({ type: 'selectPreset', preset })}
              >
                <span className="preset-title">{preset.title}</span>
                <span className="preset-kind">{PRESET_KIND[preset.expect.status]}</span>
                <span className="preset-summary">{preset.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <fieldset className="group">
        <legend>
          2. Safety rule <span className="aka">(also called an invariant)</span>
        </legend>
        <div className="choice-list">
          {template.invariants.map((invariant) => (
            <label key={invariant.id} className="choice">
              <input
                type="radio"
                name="invariant"
                value={invariant.id}
                checked={config.invariantId === invariant.id}
                onChange={() => dispatch({ type: 'setInvariant', invariantId: invariant.id })}
              />
              <span className="choice-body">
                <span className="choice-title">{invariant.title}</span>
                <span className="choice-help">{invariant.why}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>3. How the workflow is built</legend>
        {template.designOptions.map((option) => {
          const selectId = `design-${option.id}`;
          const current = option.choices.find((c) => c.id === config.design[option.id]);
          return (
            <div key={option.id} className="field">
              <label htmlFor={selectId}>{option.label}</label>
              <select
                id={selectId}
                value={config.design[option.id] ?? option.defaultChoice}
                aria-describedby={`${selectId}-help`}
                onChange={(event) =>
                  dispatch({ type: 'setDesign', option: option.id, choice: event.target.value })
                }
              >
                {option.choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </select>
              <p id={`${selectId}-help`} className="help">
                {current?.help ?? option.help}
              </p>
            </div>
          );
        })}
      </fieldset>

      <fieldset className="group">
        <legend>4. Things that can go wrong</legend>
        <p className="help group-note">
          Each control is a hard cap. The search never injects more than you allow.
        </p>
        {FAULT_CONTROLS.filter((c) => c.group === 'common').map((control) => (
          <FaultControlRow
            key={control.id}
            control={control}
            faults={config.faults}
            dispatch={dispatch}
          />
        ))}
        <AdvancedFaults faults={config.faults} dispatch={dispatch} />
      </fieldset>

      <details className="group limits">
        <summary>
          <span className="group-title">5. Search limits</span>
          <span className="limits-summary" data-testid="limits-summary">
            Try every possible order within these limits: up to {limits.maxDepth} steps,{' '}
            {limits.maxStates.toLocaleString('en-US')} states, {limits.maxBranching} choices per
            state
          </span>
        </summary>
        <LimitField
          label="Maximum steps"
          help="Longest path the search will follow."
          value={limits.maxDepth}
          min={LIMIT_BOUNDS.maxDepth.min}
          max={LIMIT_BOUNDS.maxDepth.max}
          onCommit={(maxDepth) => dispatch({ type: 'setLimits', limits: { ...limits, maxDepth } })}
        />
        <LimitField
          label="Maximum states"
          help="How many distinct situations the search may remember before it stops."
          value={limits.maxStates}
          min={LIMIT_BOUNDS.maxStates.min}
          max={LIMIT_BOUNDS.maxStates.max}
          onCommit={(maxStates) =>
            dispatch({ type: 'setLimits', limits: { ...limits, maxStates } })
          }
        />
        <LimitField
          label="Choices per state"
          help="If more things can happen next, the extra ones are skipped and the result says so."
          value={limits.maxBranching}
          min={LIMIT_BOUNDS.maxBranching.min}
          max={LIMIT_BOUNDS.maxBranching.max}
          onCommit={(maxBranching) =>
            dispatch({ type: 'setLimits', limits: { ...limits, maxBranching } })
          }
        />
      </details>

      <div className="actions">
        <button type="submit" className="button button-primary">
          {running ? 'Restart exploration' : 'Explore'}
        </button>
        {running ? (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
