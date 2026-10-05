import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function openSandbox(page: Page): Promise<void> {
  await page.goto('/#sandbox');
  await expect(page.getByRole('tab', { name: /Sandbox/ })).toHaveAttribute('aria-selected', 'true');
}

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const explore = (page: Page) =>
  page.getByRole('button', { name: /^(Explore|Restart exploration)$/ }).click();
const result = (page: Page) => page.locator('[data-status]');

test.describe('flows', () => {
  test('unsafe flow: finds the shortest counterexample and replays it step by step', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await openSandbox(page);
    await explore(page);
    await expect(result(page)).toHaveAttribute('data-status', 'violated');
    await expect(page.getByRole('heading', { name: 'Rule broken in 5 steps' })).toBeFocused();
    await expect(page.getByTestId('replay-check')).toContainText('Verified');

    const next = page.getByRole('button', { name: 'Next step' });
    for (let i = 1; i <= 5; i++) {
      await next.click();
      await expect(page.getByTestId('step-detail')).toContainText(`Step ${i} of 5`);
    }
    await expect(next).toBeDisabled();
    await expect(page.getByTestId('step-detail')).toContainText(
      'Rule broken: A booking is confirmed at most once',
    );
    await expect(
      page.getByTestId('step-detail').getByRole('table', { name: 'What changed in this step' }),
    ).toContainText('Confirmation emails sent');
    expect(problems).toEqual([]);
  });

  test('safe flow: a complete bounded-safe result is worded as bounded, never proven', async ({
    page,
  }) => {
    await openSandbox(page);
    await page.getByRole('button', { name: /One conditional update, broad failures/ }).click();
    await explore(page);
    await expect(result(page)).toHaveAttribute('data-status', 'bounded-safe', { timeout: 20_000 });
    const text = (await result(page).innerText()).toLowerCase();
    expect(text).toContain('not a proof');
    expect(text).not.toContain('proved');
    await expect(page.getByRole('button', { name: 'Next step' })).toHaveCount(0);
  });

  test('keyboard: whole path without a mouse, arrow keys step the replay', async ({ page }) => {
    await openSandbox(page);
    await page.getByRole('button', { name: 'Explore' }).focus();
    await page.keyboard.press('Enter');
    await expect(result(page)).toHaveAttribute('data-status', 'violated');
    await page.getByRole('button', { name: /Start\s*Initial state/ }).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('step-detail')).toContainText('Step 2 of 5');
    await page.keyboard.press('End');
    await expect(page.getByTestId('step-detail')).toContainText('Step 5 of 5');
    await page.keyboard.press('Home');
    await expect(page.getByTestId('step-detail')).toContainText('Initial state');
    const outline = await page.evaluate(
      () => getComputedStyle(document.activeElement as Element).outlineStyle,
    );
    expect(outline).not.toBe('none');
  });

  test('settings travel in the URL and hostile URLs are ignored with a notice', async ({
    page,
  }) => {
    await openSandbox(page);
    await page.getByRole('radio', { name: /Payment capture and refund/ }).check();
    await expect(page).toHaveURL(/t=payment-refund/);
    const url = page.url();
    await page.goto(url);
    await expect(page.getByRole('radio', { name: /Payment capture and refund/ })).toBeChecked();

    await page.goto('/?t=booking-confirmation&i=single-confirmation&f.explode=1');
    await expect(
      page.getByRole('status').filter({ hasText: 'were not valid and were ignored' }),
    ).toBeVisible();
    await page.goto('/?t=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
    await expect(page.getByRole('status').filter({ hasText: 'were not valid' })).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });

  test('limits are validated before use', async ({ page }) => {
    await openSandbox(page);
    await page.getByText('5. Search limits').click();
    const field = page.getByLabel('Maximum states');
    await field.fill('5');
    await expect(page.getByText('Enter a whole number from 100 to 100,000.')).toBeVisible();
    await field.fill('2000');
    await expect(page.getByTestId('limits-summary')).toContainText('2,000 states');
    await field.fill('1e9');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  test('cancellation is real and distinct from exhaustion', async ({ page }) => {
    await openSandbox(page);
    await page.getByRole('button', { name: /Stress: every failure at its maximum/ }).click();
    await page.getByText('5. Search limits').click();
    await page.getByLabel('Maximum states').fill('100000');
    await explore(page);
    await expect(page.getByTestId('progress-text')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(result(page)).toHaveAttribute('data-status', 'cancelled');
    await expect(page.getByRole('heading', { name: 'Search cancelled' })).toBeVisible();
    await expect(result(page)).toContainText('Nothing was concluded');
  });

  test('stress preset at default limits reports exhausted, not safe', async ({ page }) => {
    await openSandbox(page);
    await page.getByRole('button', { name: /Stress: every failure at its maximum/ }).click();
    await explore(page);
    await expect(result(page)).toHaveAttribute('data-status', 'exhausted', { timeout: 30_000 });
    await expect(result(page)).toContainText('concluded nothing');
  });

  test('rapid switching between two runs only ever shows the newest result', async ({ page }) => {
    await openSandbox(page);
    await page.getByRole('button', { name: /Stress: every failure at its maximum/ }).click();
    await explore(page);
    // Replace the slow run immediately with a different, fast one.
    await page.getByRole('button', { name: /Duplicate request/ }).click();
    await explore(page);
    await expect(result(page)).toHaveAttribute('data-status', 'violated');
    await expect(page.getByRole('heading', { name: 'Rule broken in 3 steps' })).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: 'Rule broken in 3 steps' })).toBeVisible();
    await expect(result(page)).toHaveCount(1);
  });

  test('changing settings drops the old result', async ({ page }) => {
    await openSandbox(page);
    await explore(page);
    await expect(result(page)).toHaveAttribute('data-status', 'violated');
    await page.getByRole('radio', { name: '2' }).first().check();
    await expect(result(page)).toHaveCount(0);
    await expect(page.getByText('Nothing explored yet')).toBeVisible();
  });

  test('every workflow explores to its documented outcome', async ({ page }) => {
    await openSandbox(page);
    for (const name of [
      'Payment capture and refund',
      'Inventory reservation and order',
      'Webhook receipt',
    ]) {
      await page.getByRole('radio', { name: new RegExp(name) }).check();
      await page
        .getByRole('button', { name: /Breaks the rule/ })
        .first()
        .click();
      await explore(page);
      await expect(result(page)).toHaveAttribute('data-status', 'violated');
      await expect(page.getByTestId('replay-check')).toContainText('Verified');
    }
  });
});

test.describe('layout and accessibility', () => {
  for (const [label, width, height] of [
    ['desktop', 1360, 900],
    ['390px', 390, 844],
    ['320px', 320, 700],
  ] as const) {
    test(`${label}: no horizontal scroll, no console errors, axe clean before and after exploring`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const problems = watchConsole(page);
      await openSandbox(page);
      await noHorizontalScroll(page);
      let axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
      await explore(page);
      await expect(result(page)).toHaveAttribute('data-status', 'violated');
      await page.getByRole('button', { name: 'Next step' }).click();
      await page.getByRole('button', { name: 'Next step' }).click();
      await noHorizontalScroll(page);
      axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
      expect(problems).toEqual([]);
      await context.close();
    });
  }

  test('dark colour scheme stays accessible', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await openSandbox(page);
    await explore(page);
    await expect(result(page)).toHaveAttribute('data-status', 'violated');
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    await context.close();
  });

  test('200% text size does not break the layout', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await openSandbox(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await explore(page);
    await expect(result(page)).toHaveAttribute('data-status', 'violated');
    await noHorizontalScroll(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await noHorizontalScroll(page);
    await context.close();
  });

  test('reduced motion: nothing animates or transitions', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await openSandbox(page);
    const durations = await page.evaluate(() =>
      [...document.querySelectorAll('*')].flatMap((el) => {
        const s = getComputedStyle(el);
        return [s.animationName !== 'none' ? s.animationDuration : '0s', s.transitionDuration];
      }),
    );
    expect(durations.every((d) => d.split(',').every((x) => parseFloat(x) === 0))).toBe(true);
    await context.close();
  });

  test('the diagram has a text alternative and the CSP blocks network access', async ({ page }) => {
    await openSandbox(page);
    await expect(page.getByRole('table', { name: 'Text version of the diagram' })).toBeVisible();
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(csp).toContain("connect-src 'none'");
    const blocked = await page.evaluate(() =>
      fetch('https://example.com/').then(
        () => 'allowed',
        () => 'blocked',
      ),
    );
    expect(blocked).toBe('blocked');
  });
});
