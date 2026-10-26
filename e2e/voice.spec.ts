import { test, expect, type Page } from '@playwright/test';

const fixture = {
  preferences: { goal: 'Hypertrophy', experience: 'Beginner', units: 'kg', split: 'Upper / Lower', days: 4, equipment: ['Barbell'], increment: 2.5, rirMin: 1, rirMax: 3 }, custom: [], templates: [],
  sessions: [{ id: 'voice-session', name: 'Voice practice', date: '2026-10-25T12:00:00.000Z', status: 'draft', exercises: [{ id: 'performed-bench', exerciseId: 'exercise-0', name: 'Bench press', muscle: 'Chest', min: 6, max: 10, increment: 2.5, required: 3, notes: '', pain: false, technique: true, override: null,
    sets: [1, 2, 3].map(n => ({ id: 'blank-' + n, weight: 0, reps: 0, rir: null, done: false, warmup: false })) }] }],
};
test.beforeEach(async ({ context }) => {
  await context.addInitScript(data => {
    sessionStorage.setItem('repwise-device-mode', 'yes');
    if (!localStorage.getItem('repwise:v1:guest')) localStorage.setItem('repwise:v1:guest', JSON.stringify({ data, revision: 0, dirty: true }));
  }, fixture);
});
async function open(page: Page) { await page.goto('/train/'); await page.getByRole('button', { name: /Voice practice/ }).click(); }
async function preview(page: Page, text = 'Thirty kilos, ten reps, two RIR') {
  await page.getByLabel('Spoken or typed entry').fill(text); await page.getByRole('button', { name: 'Review entry', exact: true }).click();
}
async function confirmedCount(page: Page) { return page.evaluate(() => JSON.parse(localStorage.getItem('repwise:v1:guest')!).data.sessions[0].exercises[0].sets.filter((s: { done: boolean }) => s.done).length); }

test('review, edit and confirm persists once; manual logging remains available after reload', async ({ page }) => {
  await open(page); await preview(page);
  await expect(page.getByLabel('Confirm weight')).toHaveValue('30');
  await expect(page.getByLabel('Confirm repetitions')).toHaveValue('10');
  await expect(page.getByLabel('Confirm RIR (optional)')).toHaveValue('2');
  expect(await confirmedCount(page)).toBe(0);
  await page.getByLabel('Confirm repetitions').fill('9');
  await page.getByLabel('I checked the exercise').check();
  // Deliberate duplicate DOM activation verifies the synchronous save guard.
  await page.getByRole('button', { name: 'Confirm & save set' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  expect(await confirmedCount(page)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload(); await page.getByRole('button', { name: /Voice practice/ }).click();
  await expect(page.getByLabel('Bench press set 1 reps', { exact: true })).toHaveValue('9');
  await page.getByLabel('Bench press set 2 weight', { exact: true }).fill('30');
  await page.getByLabel('Bench press set 2 reps', { exact: true }).fill('8');
  await page.getByRole('button', { name: 'Complete Bench press set 2', exact: true }).click();
  expect(await confirmedCount(page)).toBe(2);
});

test('stale preview and cancellation cannot overwrite a manual edit', async ({ page }) => {
  await open(page); await preview(page);
  await page.getByLabel('Bench press set 1 weight', { exact: true }).fill('35');
  await page.getByLabel('I checked the exercise').check(); await page.getByRole('button', { name: 'Confirm & save set' }).click();
  await expect(page.getByRole('region', { name: 'REPWISE Voice' }).getByRole('alert')).toContainText('changed during review');
  await page.getByRole('button', { name: 'Cancel entry' }).click();
  expect(await confirmedCount(page)).toBe(0);
  await expect(page.getByLabel('Bench press set 1 weight', { exact: true })).toHaveValue('35');
});

test('storage failure is visible and retry persists the same set without duplicating it', async ({ page }) => {
  await open(page); await preview(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'repwise:v1:guest') { Storage.prototype.setItem = original; throw new DOMException('Quota exceeded', 'QuotaExceededError'); } original.call(this, key, value); };
  });
  await page.getByLabel('I checked the exercise').check(); await page.getByRole('button', { name: 'Confirm & save set' }).click();
  await expect(page.getByText(/This set is in memory, but device storage failed/)).toBeVisible();
  expect(await confirmedCount(page)).toBe(0);
  await page.getByRole('button', { name: 'Confirm & save set' }).click();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  expect(await confirmedCount(page)).toBe(1);
});

test('unsupported recognition retains typed and manual entry', async ({ page, context }) => {
  await context.addInitScript(() => { Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true }); Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true }); });
  await open(page); await expect(page.getByRole('button', { name: 'Record a set' })).toBeDisabled();
  await preview(page, 'Das reps, paanch kilo');
  await expect(page.getByLabel('Confirm weight')).toHaveValue('5');
  await expect(page.getByLabel('Confirm repetitions')).toHaveValue('10');
});

// Browser API doubles exercise UI lifecycle only, not real microphone accuracy.
async function installSpeechDouble(page: Page) {
  await page.addInitScript(() => {
    class Recognition extends EventTarget {
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() { Object.assign(window, { testRecognition: this }); this.onstart?.(); }
      abort() { Object.assign(window, { microphoneAborted: true }); }
      stop() {}
    }
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: Recognition, configurable: true });
    Object.defineProperty(window, 'SpeechRecognition', { value: Recognition, configurable: true });
    const synth = new EventTarget();
    Object.assign(synth, { getVoices: () => [], speak: () => { Object.assign(window, { speechActive: true }); }, cancel: () => { Object.assign(window, { speechActive: false }); }, pause: () => {}, resume: () => {} });
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { constructor(public text: string) {} }, configurable: true });
  });
}
test('recognition result opens review, audio is opt-in and stops for a new recording', async ({ page }) => {
  await installSpeechDouble(page); await open(page);
  await page.getByRole('button', { name: 'Record a set' }).click();
  await expect(page.getByText('Listening — microphone active', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { testRecognition: { onresult: (e: unknown) => void } }).testRecognition.onresult({ results: [{ isFinal: true, 0: { transcript: '30 kilos, 10 reps, 2 RIR' } }] }));
  await page.getByLabel('I checked the exercise').check(); await page.getByRole('button', { name: 'Confirm & save set' }).click();
  expect(await page.evaluate(() => (window as unknown as { speechActive: boolean }).speechActive)).toBe(false);
  await page.getByRole('button', { name: 'Speak confirmation' }).click();
  expect(await page.evaluate(() => (window as unknown as { speechActive: boolean }).speechActive)).toBe(true);
  await page.getByText('Spoken feedback · on', { exact: true }).click();
  await page.getByRole('button', { name: 'Stop speech', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { speechActive: boolean }).speechActive)).toBe(false);
  await page.getByRole('button', { name: 'Speak confirmation' }).click();
  await page.getByRole('button', { name: 'Record a set' }).click();
  expect(await page.evaluate(() => (window as unknown as { speechActive: boolean }).speechActive)).toBe(false);
  await page.getByRole('button', { name: 'Cancel entry' }).click();
  expect(await confirmedCount(page)).toBe(1);
});

test('permission denial and navigation stop recognition without adding a set', async ({ page }) => {
  await installSpeechDouble(page); await open(page);
  await page.getByRole('button', { name: 'Record a set' }).click();
  await page.evaluate(() => (window as unknown as { testRecognition: { onerror: (e: unknown) => void } }).testRecognition.onerror({ error: 'not-allowed' }));
  await expect(page.getByRole('region', { name: 'REPWISE Voice' }).getByRole('alert')).toContainText('permission was denied');
  await page.getByRole('button', { name: 'Record a set' }).click();
  await page.evaluate(() => { Object.assign(window, { microphoneAborted: false }); });
  await page.getByRole('button', { name: 'Save & close' }).click();
  expect(await page.evaluate(() => (window as unknown as { microphoneAborted: boolean }).microphoneAborted)).toBe(true);
  expect(await confirmedCount(page)).toBe(0);
});
