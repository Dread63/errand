import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

// Real-model agent tasks. Reads OPEN_CODE_GO_API_KEY (and optional LIVE_* settings) from .env.local.
for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

export default defineConfig({
  testDir: 'tests/live-e2e',
  globalSetup: './tests/live-e2e/setup.ts',
  timeout: 360_000,
  workers: 1,
  reporter: [['list']],
  // Traces of multi-minute runs are large and have failed to write; the summary is the record.
  use: { trace: 'off' },
});
