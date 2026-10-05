// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { inlineRunner } from '../lib/runner';
import { Workspace } from './workspace';

const setup = () => {
  const user = userEvent.setup();
  const view = render(<Workspace runner={inlineRunner} syncUrl={false} />);
  return { user, view };
};

async function axeViolations(container: HTMLElement): Promise<string[]> {
  const results = await axe.run(container, {
    // jsdom has no layout engine, so colour contrast is covered by the browser tests instead.
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`);
}

describe('Workspace', () => {
  it('shows the starting workflow, rule, failures and visible limits before any run', () => {
    setup();
    expect(screen.getByRole('radio', { name: /Booking confirmation/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /confirmed at most once/ })).toBeChecked();
    expect(screen.getByTestId('limits-summary')).toHaveTextContent('up to 32 steps, 30,000 states');
    expect(screen.getByText(/Nothing explored yet/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Text version of the diagram' })).toBeInTheDocument();
  });

  it('explores, reports the shortest counterexample, and verifies the replay', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Explore' }));
    expect(
      await screen.findByRole('heading', { name: 'Rule broken in 5 steps' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('replay-check')).toHaveTextContent('Verified');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Rule broken in 5 steps' })).toHaveFocus(),
    );
  });

  it('steps through the trail with buttons and arrow keys, showing before and after', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Explore' }));
    await screen.findByRole('heading', { name: 'Shortest example that breaks the rule' });
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    const detail = screen.getByTestId('step-detail');
    expect(detail).toHaveTextContent('Step 1 of 5');
    expect(
      within(detail).getByRole('table', { name: 'What changed in this step' }),
    ).toBeInTheDocument();

    const stones = screen.getAllByRole('button', { name: /^Step \d/ });
    stones[0]!.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(detail).toHaveTextContent('Step 3 of 5');
    await user.keyboard('{End}');
    expect(detail).toHaveTextContent('Rule broken: A booking is confirmed at most once');
    expect(screen.getByRole('button', { name: 'Next step' })).toBeDisabled();
    await user.keyboard('{Home}');
    expect(detail).toHaveTextContent('Initial state');
  });

  it('marks the selected step and uses words, not colour, for failures', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Explore' }));
    await screen.findByRole('heading', { name: 'Shortest example that breaks the rule' });
    expect(screen.getAllByRole('button', { current: 'step' })).toHaveLength(1);
    expect(screen.getAllByText(/Failure: Lost answer/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rule broken here').length).toBeGreaterThan(0);
  });

  it('reports a bounded-safe result without claiming proof', async () => {
    const { user } = setup();
    await user.click(
      screen.getByRole('button', { name: /One conditional update, broad failures/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Explore' }));
    expect(
      await screen.findByRole('heading', { name: 'No violation found' }, { timeout: 15_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/not a proof/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next step' })).not.toBeInTheDocument();
  });

  it('clears the result when a failure control changes', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Explore' }));
    await screen.findByRole('heading', { name: 'Rule broken in 5 steps' });
    await user.click(screen.getByRole('switch', { name: /Slow answers/ }));
    expect(screen.getByText(/Nothing explored yet/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Slow answers/ })).toBeChecked();
  });

  it('keeps failure controls operable from the keyboard', async () => {
    const { user } = setup();
    const toggle = screen.getByRole('switch', { name: /Out-of-order delivery/ });
    toggle.focus();
    await user.keyboard(' ');
    expect(toggle).toBeChecked();
    const group = screen.getByRole('radiogroup', { name: /Duplicate delivery/ });
    const two = within(group).getByRole('radio', { name: '2' });
    two.focus();
    await user.keyboard(' ');
    expect(two).toBeChecked();
  });

  it('has no automated accessibility violations before or after a run', async () => {
    const { user, view } = setup();
    expect(await axeViolations(view.container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Explore' }));
    await screen.findByRole('heading', { name: 'Shortest example that breaks the rule' });
    expect(await axeViolations(view.container)).toEqual([]);
  });
});
