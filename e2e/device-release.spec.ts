import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const sourceId = randomUUID(), exerciseId = randomUUID();
const exercise = { id: exerciseId, exerciseId: 'bench', name: 'Bench press', muscle: 'Chest', min: 6, max: 10, increment: 2.5, required: 3, notes: '', pain: false, technique: true, override: null,
  sets: [6, 5, 6].map(reps => ({ id: randomUUID(), weight: 30, reps, rir: null, done: true, warmup: false })) };
const data = { preferences: { goal: 'Hypertrophy', experience: 'Beginner', units: 'kg', split: 'Upper / Lower', days: 4, equipment: ['Barbell'], increment: 2.5, rirMin: 1, rirMax: 3 }, custom: [],
  sessions: [{ id: sourceId, name: 'Push baseline', date: new Date(Date.now() - 86400000).toISOString(), status: 'complete', exercises: [exercise] }],
  templates: [{ id: randomUUID(), name: 'Push', days: [], exercises: [exercise] }] };

test.beforeEach(async ({ context }) => {
  await context.addInitScript(({ data }) => {
    sessionStorage.setItem('repwise-device-mode', 'yes');
    if (!localStorage.getItem('repwise:v1:guest')) localStorage.setItem('repwise:v1:guest', JSON.stringify({ data, revision: 0, dirty: true }));
  }, { data });
});

test('modify, persist and apply a target through the visible workout controls', async ({ page }) => {
  await page.goto('/workouts/analysis/?session=' + sourceId);
  await expect(page.getByRole('heading', { name: 'What happened', exact: true })).toBeVisible();
  const card = page.locator('#exercise-' + exerciseId);
  await card.getByRole('button', { name: 'Modify target', exact: true }).click();
  const weight = card.getByLabel('Weight (kg)', { exact: true });
  await weight.fill('32.5'); await weight.press('Tab');
  await expect(card.getByLabel('Minimum reps', { exact: true })).toBeFocused();
  await card.getByRole('button', { name: 'Save modified target', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('Target saved on this device');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(card.getByText('Saved decision history (1)', { exact: true })).toBeVisible();
  await page.goto('/train/');
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Apply saved target', exact: true }).click();
  for (let i = 1; i <= 3; i++) {
    await expect(page.getByLabel(`Bench press set ${i} weight`, { exact: true })).toHaveValue('32.5');
    await page.getByLabel(`Bench press set ${i} reps`, { exact: true }).fill('8');
    await page.getByRole('button', { name: `Complete Bench press set ${i}`, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Finish & save', exact: true }).click();
  await expect(page).toHaveURL(/workouts\/analysis\/\?session=/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('repwise:targets:v1:guest') ?? '[]')[0]?.status)).toBe('applied');
});

test('opens an unvisited analysis URL and reloads it offline', async ({ page, context }) => {
  await page.goto('/train/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.goto('/workouts/analysis/?session=' + sourceId);
  await expect(page.getByRole('heading', { name: 'What happened', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'What happened', exact: true })).toBeVisible();
  await context.setOffline(false);
});

test('two tabs cannot silently overwrite each other’s target decision', async ({ page, context }) => {
  const other = await context.newPage();
  await Promise.all([page.goto('/workouts/analysis/?session=' + sourceId), other.goto('/workouts/analysis/?session=' + sourceId)]);
  const first = page.getByRole('button', { name: 'Accept target', exact: true });
  const second = other.getByRole('button', { name: 'Accept target', exact: true });
  await expect(first).toBeEnabled(); await expect(second).toBeEnabled();
  await Promise.all([first.click(), second.click()]);
  await expect.poll(async () => (await page.locator('[role="alert"]').allTextContents()).join(' ') + (await other.locator('[role="alert"]').allTextContents()).join(' ')).toContain('Another decision changed this target');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('repwise:targets:v1:guest') ?? '[]').length)).toBe(1);
});
