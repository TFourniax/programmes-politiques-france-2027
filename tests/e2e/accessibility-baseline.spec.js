import { test, expect } from '@playwright/test';

function durationSeconds(value) {
  const raw = String(value || '').trim();
  if (raw.endsWith('ms')) return Number.parseFloat(raw) / 1000;
  if (raw.endsWith('s')) return Number.parseFloat(raw);
  return Number.POSITIVE_INFINITY;
}

test('document structure and keyboard path expose a usable accessibility baseline', async ({ page }) => {
  await page.goto('/?mode=chat#explorer');

  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('heading', { name: 'Recherche libre dans le corpus' })).toBeVisible();

  const duplicateIds = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id).filter(Boolean);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  expect(duplicateIds).toEqual([]);

  const unnamedControls = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('button,input,textarea,select,a[href]')];
    return controls
      .filter((node) => {
        const label = node.getAttribute('aria-label')
          || node.getAttribute('title')
          || node.textContent
          || (node.labels && [...node.labels].map((item) => item.textContent).join(' '));
        return !String(label || '').trim();
      })
      .map((node) => node.outerHTML.slice(0, 180));
  });
  expect(unnamedControls).toEqual([]);

  const textarea = page.getByRole('textbox', { name: 'Votre question' });
  await textarea.focus();
  await expect(textarea).toBeFocused();
  await textarea.fill('Que propose Renaissance sur le nucléaire ?');
  await textarea.press('Tab');
  await expect(page.getByRole('button', { name: 'Envoyer la question' })).toBeFocused();
});

test('reduced-motion preference disables non-essential animation and smooth scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?mode=chat#explorer');
  const values = await page.evaluate(() => {
    const node = document.querySelector('.modeSwitcherWide button');
    const style = getComputedStyle(node);
    return {
      transitionDuration: style.transitionDuration,
      animationDuration: style.animationDuration,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    };
  });
  expect(durationSeconds(values.transitionDuration)).toBeLessThanOrEqual(0.0001);
  expect(durationSeconds(values.animationDuration)).toBeLessThanOrEqual(0.0001);
  expect(values.scrollBehavior).toBe('auto');
});

test('critical mobile controls meet a 44px comfort target', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'));
  await page.goto('/?mode=chat#explorer');

  const selectors = [
    page.getByRole('button', { name: 'Envoyer la question' }),
    page.getByRole('button', { name: /^Comparer/ }),
    page.getByRole('button', { name: /^Candidats/ }),
    page.getByRole('button', { name: /^Thèmes/ }),
  ];
  for (const locator of selectors) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
