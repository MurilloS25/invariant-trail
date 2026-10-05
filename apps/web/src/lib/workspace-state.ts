import {
  DEFAULT_LIMITS,
  REQUEST_VERSION,
  type ExplorationOutcome,
  type ExplorationRequest,
  type ExplorationStats,
  type FaultSettings,
  type Limits,
} from '@invariant-trail/contracts';
import { getTemplate, TEMPLATES, type Preset, type TemplateDef } from '@invariant-trail/engine';

export type Config = Pick<
  ExplorationRequest,
  'templateId' | 'invariantId' | 'design' | 'faults' | 'limits'
>;

export type RunState =
  | { phase: 'idle' }
  | { phase: 'running'; runId: number; stats: ExplorationStats }
  | { phase: 'done'; runId: number; outcome: ExplorationOutcome; request: ExplorationRequest };

export interface WorkspaceState {
  config: Config;
  run: RunState;
  /** Selected replay step: 0 is the starting state, n is the state after step n. */
  step: number;
  /** Plain-language notice, for example when a link's settings were rejected. */
  notice: string | null;
}

export type Action =
  | { type: 'load'; config: Config; notice: string | null }
  | { type: 'selectTemplate'; templateId: string }
  | { type: 'selectPreset'; preset: Preset }
  | { type: 'setInvariant'; invariantId: string }
  | { type: 'setDesign'; option: string; choice: string }
  | { type: 'setFault'; fault: keyof FaultSettings; value: number | boolean }
  | { type: 'setLimits'; limits: Limits }
  | { type: 'runStarted'; runId: number }
  | { type: 'progress'; runId: number; stats: ExplorationStats }
  | { type: 'runDone'; runId: number; outcome: ExplorationOutcome; request: ExplorationRequest }
  | { type: 'runAborted' }
  | { type: 'selectStep'; step: number }
  | { type: 'dismissNotice' };

export const FIRST_TEMPLATE = TEMPLATES[0] as TemplateDef;
export const STARTER_PRESET_ID = 'retry-after-lost-response';

export function presetConfig(template: TemplateDef, preset: Preset): Config {
  return {
    templateId: template.id,
    invariantId: preset.invariantId,
    design: { ...preset.design },
    faults: { ...preset.faults },
    limits: { ...(preset.limits ?? DEFAULT_LIMITS) },
  };
}

export function defaultConfig(): Config {
  const preset =
    FIRST_TEMPLATE.presets.find((p) => p.id === STARTER_PRESET_ID) ??
    (FIRST_TEMPLATE.presets[0] as Preset);
  return presetConfig(FIRST_TEMPLATE, preset);
}

export function initialState(): WorkspaceState {
  return { config: defaultConfig(), run: { phase: 'idle' }, step: 0, notice: null };
}

export function toRequest(config: Config): ExplorationRequest {
  return { version: REQUEST_VERSION, ...config };
}

function changed(state: WorkspaceState, config: Config): WorkspaceState {
  // Any change to the settings invalidates the previous result, so a result can never describe
  // settings other than the ones on screen.
  return { ...state, config, run: { phase: 'idle' }, step: 0 };
}

export function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case 'load':
      return { ...changed(state, action.config), notice: action.notice };
    case 'selectTemplate': {
      const template = getTemplate(action.templateId);
      if (!template) return state;
      const preset = template.presets[0] as Preset;
      return { ...changed(state, presetConfig(template, preset)), notice: null };
    }
    case 'selectPreset': {
      const template = getTemplate(state.config.templateId);
      if (!template) return state;
      return { ...changed(state, presetConfig(template, action.preset)), notice: null };
    }
    case 'setInvariant':
      return changed(state, { ...state.config, invariantId: action.invariantId });
    case 'setDesign':
      return changed(state, {
        ...state.config,
        design: { ...state.config.design, [action.option]: action.choice },
      });
    case 'setFault':
      return changed(state, {
        ...state.config,
        faults: { ...state.config.faults, [action.fault]: action.value },
      });
    case 'setLimits':
      return changed(state, { ...state.config, limits: action.limits });
    case 'runStarted':
      return {
        ...state,
        step: 0,
        run: { phase: 'running', runId: action.runId, stats: emptyStats() },
      };
    case 'progress':
      if (state.run.phase !== 'running' || state.run.runId !== action.runId) return state;
      return { ...state, run: { ...state.run, stats: action.stats } };
    case 'runDone':
      // Results of anything but the current run are dropped.
      if (state.run.phase !== 'running' || state.run.runId !== action.runId) return state;
      return {
        ...state,
        step: 0,
        run: {
          phase: 'done',
          runId: action.runId,
          outcome: action.outcome,
          request: action.request,
        },
      };
    case 'runAborted':
      return { ...state, run: { phase: 'idle' } };
    case 'selectStep':
      return { ...state, step: Math.max(0, action.step) };
    case 'dismissNotice':
      return { ...state, notice: null };
  }
}

function emptyStats(): ExplorationStats {
  return {
    statesDiscovered: 0,
    statesExpanded: 0,
    transitionsGenerated: 0,
    duplicatesSkipped: 0,
    maxDepthReached: 0,
    branchTruncations: 0,
    depthCutoffStates: 0,
  };
}
