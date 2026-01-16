/**
 * playwright.config.js - Playwright configuration for extension E2E tests.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  use: {
    headless: true
  }
});
