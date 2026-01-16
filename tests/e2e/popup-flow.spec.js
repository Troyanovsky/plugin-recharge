/**
 * popup-flow.spec.js - E2E tests for critical popup user flows.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { test, expect, chromium } from '@playwright/test';

test('popup loads and starts one-time timer', async () => {
  const extensionPath = path.resolve(__dirname, '../..');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recharge-e2e-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    const serviceWorker = context.serviceWorkers().length
      ? context.serviceWorkers()[0]
      : await context.waitForEvent('serviceworker');
    const extensionId = serviceWorker.url().split('/')[2];
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(page.locator('#startTimerBtn')).toBeVisible();
    await page.locator('#oneTimeInterval').evaluate((element) => {
      element.value = '1';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#startTimerBtn').click();

    await expect(page.locator('#startTimerBtn')).toBeDisabled();
    await expect(page.locator('#startTimerBtn')).toContainText(':');
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
