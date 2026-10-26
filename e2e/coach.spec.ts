import { test, expect } from '@playwright/test';
test('device coach is honest, opt-in and does not transmit the journal', async ({ context, page }) => {
  await context.addInitScript(() => { sessionStorage.setItem('repwise-device-mode', 'yes'); localStorage.setItem('repwise:v1:guest', JSON.stringify({ revision: 0, dirty: false, data: { preferences: { goal: 'Hypertrophy', experience: 'Beginner', units: 'kg', split: 'Upper / Lower', days: 4, equipment: [], increment: 2.5, rirMin: 1, rirMax: 3 }, custom: [], templates: [], sessions: [] } })); });
  let requests = 0; page.on('request', r => { if (r.url().includes('/functions/v1/ask-repwise')) requests++; });
  await page.goto('/train/'); await page.getByRole('button', { name: 'Ask REPWISE', exact: true }).click();
  const coach = page.getByRole('region', { name: 'Ask REPWISE', exact: true });
  await expect(coach.getByText(/AI answers are not connected yet/)).toBeVisible();
  await expect(coach.getByLabel('Allow workout history')).not.toBeChecked();
  await coach.getByLabel('Your question').fill('Why did my reps decrease?');
  await expect(coach.getByRole('button', { name: 'Ask REPWISE', exact: true })).toBeDisabled();
  await coach.getByLabel('Allow workout history').check();
  await coach.getByText('Preview shared workout context', { exact: true }).click();
  await expect(coach.getByText(/Calculated on this device/)).toBeVisible();
  expect(requests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await coach.getByLabel('Allow workout history').uncheck();
  await expect(coach.getByText('Preview shared workout context', { exact: true })).toHaveCount(0);
});
