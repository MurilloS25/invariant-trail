import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WORKFLOWS = [
  'Booking confirmation',
  'Payment capture and refund',
  'Inventory reservation and order',
  'Webhook receipt',
];

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

/** Real rendered geometry of every visible diagram: nothing overlaps, nothing is cut off. */
async function diagramProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const overlap = (a: DOMRect, b: DOMRect, margin = 0) =>
      a.left < b.right + margin &&
      b.left < a.right + margin &&
      a.top < b.bottom + margin &&
      b.top < a.bottom + margin;
    document.querySelectorAll<HTMLElement>('.diagram').forEach((diagram, d) => {
      if (diagram.offsetParent === null) return;
      const svg = diagram.querySelector('svg') as SVGSVGElement;
      const frame = diagram.getBoundingClientRect();
      const svgBox = svg.getBoundingClientRect();
      if (svgBox.right > frame.right + 1 || svgBox.left < frame.left - 1) {
        problems.push(`diagram ${d}: svg wider than its container`);
      }
      if (diagram.scrollWidth > diagram.clientWidth + 1)
        problems.push(`diagram ${d}: scrolls sideways`);
      const nodes = [...svg.querySelectorAll('.diagram-node rect')].map((n) =>
        n.getBoundingClientRect(),
      );
      const badges = [...svg.querySelectorAll('.diagram-badge')].map((b) => ({
        rect: b.querySelector('rect')!.getBoundingClientRect(),
        text: b.querySelector('text')!.getBoundingClientRect(),
        label: b.textContent ?? '',
      }));
      badges.forEach((badge, i) => {
        if (badge.text.width > badge.rect.width + 1)
          problems.push(`diagram ${d}: label "${badge.label}" overflows its pill`);
        if (nodes.some((n) => overlap(badge.rect, n)))
          problems.push(`diagram ${d}: label "${badge.label}" overlaps a node`);
        badges.slice(i + 1).forEach((other) => {
          if (overlap(badge.rect, other.rect))
            problems.push(`diagram ${d}: labels "${badge.label}" and "${other.label}" overlap`);
        });
        if (badge.rect.left < svgBox.left - 1 || badge.rect.right > svgBox.right + 1) {
          problems.push(`diagram ${d}: label "${badge.label}" is cut off`);
        }
      });
      svg.querySelectorAll('.diagram-node').forEach((node) => {
        const rect = node.querySelector('rect')!.getBoundingClientRect();
        node.querySelectorAll('text').forEach((text) => {
          const box = text.getBoundingClientRect();
          if (box.left < rect.left - 1 || box.right > rect.right + 1) {
            problems.push(`diagram ${d}: node text "${text.textContent}" overflows its box`);
          }
        });
      });
    });
    return problems;
  });
}

test.describe('Learn mode', () => {
  test('is the default and starts with a clear explanation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('tab', { name: /Learn/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Learn why reliable systems fail',
    );
    await expect(page.getByText('students and junior developers')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start a guided lesson' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the sandbox' })).toBeVisible();
    await expect(page.getByText('1 item available')).toBeVisible();
    await expect(
      page.getByRole('radio', { name: /The booking that was confirmed twice/ }),
    ).toBeChecked();
    await expect(page.getByRole('heading', { name: 'What must never happen?' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What could go wrong?' })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: /Sandbox/ })).toBeHidden();
  });

  test('a full guided lesson: predict, run, replay, understand, compare', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto('/');
    await page.getByRole('radio', { name: 'I think it will hold' }).check();
    await page.getByRole('button', { name: 'Run the simulation' }).click();
    await expect(page.locator('[data-status="violated"]').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Rule broken in 5 steps/ })).toBeFocused();
    await expect(page.getByText(/You predicted it would hold. It broke/)).toBeVisible();

    await page.getByRole('button', { name: 'Next step' }).click();
    await expect(page.getByTestId('step-detail')).toContainText('Step 1 of 5');

    await expect(page.getByRole('heading', { name: 'Why it happened' })).toBeVisible();
    await expect(page.getByText('Idempotency.', { exact: false }).first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'How real systems usually prevent it' }),
    ).toBeVisible();
    await expect(page.getByText('common patterns, not guarantees')).toBeVisible();

    await page
      .getByRole('button', { name: /Try the same failures against a protected design/ })
      .click();
    const safe = page.locator('[data-status="bounded-safe"]');
    await expect(safe).toBeVisible();
    await expect(safe).toContainText('this one rule');
    await expect(safe).toContainText('not a proof');
    await expect(
      page.getByRole('heading', { name: 'No violation found', exact: true }),
    ).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('every lesson runs to a violation and a protected result', async ({ page }) => {
    await page.goto('/');
    for (const title of [
      /charged twice/i,
      /Two buyers, one unit/,
      /Webhooks that arrive out of order/,
    ]) {
      await page.getByRole('radio', { name: title }).check();
      await page.getByRole('button', { name: 'Run the simulation' }).click();
      await expect(page.locator('[data-status="violated"]')).toBeVisible();
      await page.getByRole('button', { name: /protected design/ }).click();
      await expect(page.locator('[data-status="bounded-safe"]')).toBeVisible();
    }
  });

  test('works with the keyboard only', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Run the simulation' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-status="violated"]')).toBeVisible();
    await page.getByRole('button', { name: /Start\s*Initial state/ }).focus();
    await page.keyboard.press('End');
    await expect(page.getByTestId('step-detail')).toContainText('Step 5 of 5');
  });

  test('tabs switch with the keyboard and keep Sandbox settings', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: /Learn/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /Sandbox/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: /Sandbox/ })).toBeFocused();
    await page.getByRole('radio', { name: /Payment capture and refund/ }).check();
    await page.keyboard.press('Home');
    await page.getByRole('tab', { name: /Learn/ }).click();
    await page.getByRole('tab', { name: /Sandbox/ }).click();
    await expect(page.getByRole('radio', { name: /Payment capture and refund/ })).toBeChecked();
  });

  test('hero links open the right mode, and existing sandbox URLs still work', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Open the sandbox' }).click();
    await expect(page.getByRole('tab', { name: /Sandbox/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.goto('/?t=inventory-order&i=no-oversell&d.writes=transactional&f.concurrent=1');
    await expect(page.getByRole('tab', { name: /Sandbox/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByRole('radio', { name: /Inventory reservation and order/ }),
    ).toBeChecked();
    await page.goto('/?lesson=last-unit');
    await expect(page.getByRole('radio', { name: /Two buyers, one unit/ })).toBeChecked();
    await page.goto('/?lesson=%3Cscript%3E');
    await expect(
      page.getByRole('radio', { name: /The booking that was confirmed twice/ }),
    ).toBeChecked();
  });

  test('lesson cancellation and rapid re-run show only the newest result', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Run the simulation' }).click();
    await page.getByRole('button', { name: /Run again|Run the simulation/ }).click();
    await expect(page.locator('[data-status="violated"]')).toHaveCount(1);
  });
});

test.describe('Sandbox mode', () => {
  test('keeps every technical control, with advanced ones collapsed and limits collapsed', async ({
    page,
  }) => {
    await page.goto('/#sandbox');
    await expect(page.getByRole('radio', { name: /Booking confirmation/ })).toBeVisible();
    await expect(page.locator('.setup .aka')).toBeVisible();
    await expect(page.getByRole('button', { name: /Duplicate request/ })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: /Duplicate delivery/ })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: /Client retries/ })).toBeVisible();
    const advanced = page.locator('details.advanced');
    await expect(advanced).not.toHaveAttribute('open', '');
    await expect(page.getByRole('switch', { name: /Slow answers/ })).toBeHidden();
    await advanced.locator('summary').click();
    await expect(page.getByRole('switch', { name: /Slow answers/ })).toBeVisible();
    await expect(page.getByRole('switch', { name: /Out-of-order delivery/ })).toBeVisible();
    await expect(page.getByRole('switch', { name: /Concurrent work/ })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: /Crash between writes/ })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: /Late retry/ })).toBeVisible();
    await expect(page.locator('details.limits')).not.toHaveAttribute('open', '');
    await expect(page.getByTestId('limits-summary')).toContainText(
      'Try every possible order within these limits',
    );
  });

  test('desktop: the settings column scrolls on its own and the result stays reachable', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 1360, height: 700 } });
    const page = await context.newPage();
    await page.goto('/#sandbox');
    const column = page.locator('.col-setup');
    await expect(column).toBeVisible();
    await page.evaluate(() => document.getElementById('panel-sandbox')?.scrollIntoView());
    const position = await column.evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe('sticky');
    const heights = await column.evaluate((el) => ({
      client: el.clientHeight,
      scroll: el.scrollHeight,
    }));
    expect(heights.client).toBeLessThanOrEqual(700);
    expect(heights.scroll).toBeGreaterThan(heights.client);
    // The primary action stays in view without scrolling the page.
    const explore = page.getByRole('button', { name: 'Explore' });
    await expect(explore).toBeInViewport();
    await column.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(explore).toBeInViewport();
    await explore.click();
    await expect(page.locator('[data-status]')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Rule broken in 5 steps/ })).toBeFocused();
    await expect(page.getByRole('heading', { name: /Rule broken in 5 steps/ })).toBeInViewport();
    // The selection is kept: settings were not cleared by running.
    await expect(page.getByRole('radio', { name: /Booking confirmation/ })).toBeChecked();
    await context.close();
  });

  test('focus order reaches settings, then the result, with nothing hidden under the sticky bar', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 1360, height: 700 } });
    const page = await context.newPage();
    await page.goto('/#sandbox');
    await page.getByRole('button', { name: 'Explore' }).focus();
    const covered = await page.evaluate(() => {
      const bar = document.querySelector('.actions')!.getBoundingClientRect();
      const focus = document.activeElement!.getBoundingClientRect();
      return focus.top < bar.bottom && focus.bottom > bar.top;
    });
    expect(covered).toBe(true); // the bar itself holds the focused button
    // Tab through the settings; every focused control must be fully visible, not under the bar.
    await page.getByRole('radio', { name: /Webhook receipt/ }).focus();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const hidden = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const bar = document.querySelector('.actions')!.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        if (el.closest('.actions')) return false;
        if (!el.closest('.col-setup')) return false;
        return box.width > 0 && box.bottom > bar.top + 1 && box.top < bar.bottom;
      });
      expect(hidden).toBe(false);
    }
    await context.close();
  });
});

test.describe('diagrams', () => {
  for (const [label, width, height] of [
    ['desktop', 1360, 900],
    ['tablet', 768, 900],
    ['390px', 390, 844],
    ['320px', 320, 700],
  ] as const) {
    test(`${label}: no overlaps or cut-off text in any workflow`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      await page.goto('/#sandbox');
      for (const name of WORKFLOWS) {
        await page.getByRole('radio', { name: new RegExp(name) }).check();
        await expect(page.locator('.diagram:visible').first()).toBeVisible();
        expect(await diagramProblems(page), `${name} at ${label}`).toEqual([]);
        await noHorizontalScroll(page);
      }
      // The Learn scenario diagrams too.
      await page.getByRole('tab', { name: /Learn/ }).click();
      for (const title of [
        /confirmed twice/,
        /charged twice/i,
        /Two buyers, one unit/,
        /out of order/,
      ]) {
        await page.getByRole('radio', { name: title }).check();
        expect(await diagramProblems(page)).toEqual([]);
      }
      await context.close();
    });
  }

  test('200% text: diagrams still fit and labels stay inside', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const page = await context.newPage();
    await page.goto('/#sandbox');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    for (const name of WORKFLOWS) {
      await page.getByRole('radio', { name: new RegExp(name) }).check();
      expect(await diagramProblems(page), name).toEqual([]);
    }
    await noHorizontalScroll(page);
    await context.close();
  });
});

test.describe('layout and accessibility across both modes', () => {
  for (const [label, width, height] of [
    ['desktop', 1360, 900],
    ['390px', 390, 844],
    ['320px', 320, 700],
  ] as const) {
    test(`${label}: Learn and Sandbox have no horizontal scroll, no console errors, axe clean before and after running`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      const problems = watchConsole(page);
      await page.goto('/');
      await noHorizontalScroll(page);
      let axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
      await page.getByRole('button', { name: 'Run the simulation' }).click();
      await page.getByRole('button', { name: /protected design/ }).click();
      await expect(page.locator('[data-status="bounded-safe"]')).toBeVisible();
      await noHorizontalScroll(page);
      axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);

      await page.getByRole('tab', { name: /Sandbox/ }).click();
      await page.getByRole('button', { name: 'Explore' }).click();
      await expect(page.locator('[data-status="violated"]:visible')).toBeVisible();
      await noHorizontalScroll(page);
      axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
      expect(problems).toEqual([]);
      await context.close();
    });
  }

  test('dark scheme and reduced motion in Learn', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Run the simulation' }).click();
    await expect(page.locator('[data-status="violated"]')).toBeVisible();
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    const motion = await page.evaluate(() =>
      [...document.querySelectorAll('*')].some((el) => {
        const s = getComputedStyle(el);
        return (
          (s.animationName !== 'none' && parseFloat(s.animationDuration) > 0) ||
          s.transitionDuration.split(',').some((d) => parseFloat(d) > 0)
        );
      }),
    );
    expect(motion).toBe(false);
    await context.close();
  });

  test('200% text in Learn at phone width does not overflow', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('/');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.getByRole('button', { name: 'Run the simulation' }).click();
    await expect(page.locator('[data-status="violated"]')).toBeVisible();
    await noHorizontalScroll(page);
    await context.close();
  });
});
