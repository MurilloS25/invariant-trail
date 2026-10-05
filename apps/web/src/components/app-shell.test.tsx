// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { inlineRunner } from '../lib/runner';
import { AppShell } from './app-shell';

const setup = () => {
  const user = userEvent.setup();
  const view = render(<AppShell runner={inlineRunner} syncUrl={false} />);
  return { user, view };
};

describe('AppShell', () => {
  it('opens in Learn mode with the Sandbox panel hidden', () => {
    setup();
    expect(screen.getByRole('tab', { name: /Learn/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'What must never happen?' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'What could go wrong?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run the simulation' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Explore' })).not.toBeInTheDocument();
  });

  it('switches to the Sandbox with the keyboard and keeps its controls', async () => {
    const { user } = setup();
    screen.getByRole('tab', { name: /Learn/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Sandbox/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Sandbox/ })).toHaveFocus();
    const panel = screen.getByRole('tabpanel', { name: /Sandbox/ });
    expect(within(panel).getByRole('button', { name: 'Explore' })).toBeVisible();
    expect(within(panel).getByRole('radiogroup', { name: /Client retries/ })).toBeVisible();
  });

  it('keeps timing, ordering and crash controls collapsed until opened', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: /Sandbox/ }));
    const summary = screen.getByText(/Timing, ordering and crashes/);
    const details = summary.closest('details')!;
    expect(details.open).toBe(false);
    await user.click(summary);
    expect(details.open).toBe(true);
    expect(within(details).getByRole('switch', { name: /Slow answers/ })).toBeVisible();
    expect(screen.getByText(/Try every possible order within these limits/)).toBeInTheDocument();
  });

  it('runs a full guided lesson with prediction, explanation and a protected comparison', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('radio', { name: 'I think it will break' }));
    await user.click(screen.getByRole('button', { name: 'Run the simulation' }));
    expect(
      await screen.findByRole('heading', { name: 'Rule broken in 5 steps' }),
    ).toBeInTheDocument();
    expect(screen.getByText('You predicted it would break, and it did.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Why it happened' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'How real systems usually prevent it' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/common patterns, not guarantees/)).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /Try the same failures against a protected design/ }),
    );
    const protectedHeading = await screen.findByRole(
      'heading',
      { name: 'No violation found', level: 3 },
      { timeout: 15_000 },
    );
    expect(protectedHeading).toBeInTheDocument();
    expect(screen.getByText(/this one rule only/)).toBeInTheDocument();
  });

  it('resets a lesson when another one is chosen', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Run the simulation' }));
    await screen.findByRole('heading', { name: 'Rule broken in 5 steps' });
    await user.click(screen.getByRole('radio', { name: /Two buyers, one unit/ }));
    expect(screen.queryByRole('heading', { name: /Rule broken in/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Two buyers, one unit', level: 3 })).toBeVisible();
  });

  it('has no automated accessibility violations in either mode', async () => {
    const { user, view } = setup();
    const run = async () =>
      (
        await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } })
      ).violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`);
    expect(await run()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Run the simulation' }));
    await screen.findByRole('heading', { name: 'Rule broken in 5 steps' });
    expect(await run()).toEqual([]);
    await user.click(screen.getByRole('tab', { name: /Sandbox/ }));
    expect(await run()).toEqual([]);
  });
});
