import {
  DEFAULT_LIMITS,
  REQUEST_VERSION,
  type ExplorationRequest,
} from '@invariant-trail/contracts';
import { runExploration } from './resolve';
import { ENGINE_VERSION } from './version';
import { TEMPLATES } from './templates';

export interface GoldenStep {
  id: string;
  actor: string;
  label: string;
  fault?: string;
}

export interface GoldenExample {
  presetId: string;
  title: string;
  invariantId: string;
  status: string;
  request: ExplorationRequest;
  statesDiscovered: number;
  limitsHit: string[];
  complete?: boolean;
  /** Present for violations. */
  shortest?: number;
  violation?: string;
  steps?: GoldenStep[];
}

export interface GoldenFile {
  engineVersion: string;
  templateId: string;
  examples: GoldenExample[];
}

/** Runs every built-in preset and records the outcome. Checked in under `examples/`. */
export function buildGoldenFiles(): GoldenFile[] {
  return TEMPLATES.map((template) => ({
    engineVersion: ENGINE_VERSION,
    templateId: template.id,
    examples: template.presets.map((preset): GoldenExample => {
      const request: ExplorationRequest = {
        version: REQUEST_VERSION,
        templateId: template.id,
        invariantId: preset.invariantId,
        design: preset.design,
        faults: preset.faults,
        limits: preset.limits ?? DEFAULT_LIMITS,
      };
      const outcome = runExploration(request);
      const example: GoldenExample = {
        presetId: preset.id,
        title: preset.title,
        invariantId: preset.invariantId,
        status: outcome.status,
        request,
        statesDiscovered: outcome.stats.statesDiscovered,
        limitsHit: outcome.limitsHit,
      };
      if (outcome.status === 'bounded-safe') example.complete = outcome.complete;
      if (outcome.status === 'violated') {
        const { counterexample } = outcome;
        example.shortest = counterexample.steps.length;
        example.violation = counterexample.violation.message;
        example.steps = counterexample.steps.map((step) => {
          const golden: GoldenStep = {
            id: step.transition.id,
            actor: step.transition.actor,
            label: step.transition.label,
          };
          if (step.transition.fault) golden.fault = step.transition.fault;
          return golden;
        });
      }
      return example;
    }),
  }));
}
