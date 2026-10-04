import type { ExplorationOutcome, FaultId, LimitKind } from '@invariant-trail/contracts';

export type Tone = 'violation' | 'holds' | 'inconclusive' | 'invalid';

export interface OutcomeCopy {
  tone: Tone;
  /** Short status word shown next to the icon, so status never relies on colour. */
  badge: string;
  headline: string;
  paragraphs: string[];
}

export const FAULT_NAMES: Record<FaultId, string> = {
  duplicate: 'Duplicate delivery',
  lostResponse: 'Lost answer',
  delay: 'Slow answers',
  reorder: 'Out-of-order delivery',
  concurrent: 'Concurrent work',
  crash: 'Crash between writes',
  retry: 'Retry',
  lateRetry: 'Late retry',
};

const LIMIT_NAMES: Record<LimitKind, string> = {
  depth: 'step limit',
  branching: 'branching limit',
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const count = (n: number): string => n.toLocaleString('en-US');

/**
 * Plain-language summary of an outcome. The wording is deliberate: it never says "safe" or
 * "proved", and it always says what the answer covers.
 */
export function describeOutcome(outcome: ExplorationOutcome): OutcomeCopy {
  const explored = count(outcome.stats.statesDiscovered);
  switch (outcome.status) {
    case 'violated': {
      const steps = outcome.counterexample.steps.length;
      const paragraphs = [outcome.counterexample.violation.message];
      paragraphs.push(
        outcome.minimalInModel
          ? 'This is the shortest path to a broken rule in this model: no path with fewer steps exists under these settings.'
          : 'This is the shortest path among the choices the search kept. The branching limit cut some choices, so a shorter path may exist.',
      );
      return {
        tone: 'violation',
        badge: 'Rule broken',
        headline:
          steps === 0
            ? 'The rule is already broken in the starting state'
            : `Rule broken in ${plural(steps, 'step', 'steps')}`,
        paragraphs,
      };
    }
    case 'bounded-safe': {
      if (outcome.complete) {
        return {
          tone: 'holds',
          badge: 'No violation found',
          headline: 'No violation found',
          paragraphs: [
            `The search explored all ${explored} reachable states of this model under these failure settings, and none broke the selected rule.`,
            'That covers this model, these settings and this one rule only. It is not a proof that a real system is correct.',
          ],
        };
      }
      const hidden = outcome.limitsHit.map((l) => LIMIT_NAMES[l]).join(' and ');
      return {
        tone: 'inconclusive',
        badge: 'No violation found within limits',
        headline: 'No violation found within these limits',
        paragraphs: [
          `None of the ${explored} states explored broke the rule, but the ${hidden} hid some states. Raise the limits to look further.`,
          'This is not a proof: a violation may exist beyond the limits.',
        ],
      };
    }
    case 'exhausted':
      return {
        tone: 'inconclusive',
        badge: 'Out of state budget',
        headline: 'Search stopped: state budget used up',
        paragraphs: [
          `The search reached its limit of ${count(outcome.limits?.maxStates ?? 0)} states before it could finish, so it concluded nothing about the rule.`,
          'Raise the state limit, or switch off some failures to shrink the search.',
        ],
      };
    case 'cancelled':
      return {
        tone: 'inconclusive',
        badge: 'Cancelled',
        headline: 'Search cancelled',
        paragraphs: [
          `You stopped the search after ${explored} states. Nothing was concluded about the rule.`,
        ],
      };
    case 'invalid':
      return {
        tone: 'invalid',
        badge: 'Cannot explore',
        headline: "These settings can't be explored",
        paragraphs: outcome.issues,
      };
  }
}
