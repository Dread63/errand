import { defineConfig } from '@playwright/test';

// Generates the Chrome Web Store screenshots in docs/store (npm run store-assets).
export default defineConfig({
  testDir: 'scripts',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  workers: 1,
});
