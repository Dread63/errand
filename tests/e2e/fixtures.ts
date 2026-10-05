import { type BrowserContext, chromium, type Page, test as base, type Worker } from '@playwright/test';
import path from 'node:path';
import { type Servers, startServers } from './servers';

const extPath = path.resolve('.output/chrome-mv3');

export const test = base.extend<{ context: BrowserContext; sw: Worker; extensionId: string }, { servers: Servers }>({
  servers: [
    async ({}, use) => {
      const s = await startServers();
      await use(s);
      await s.close();
    },
    { scope: 'worker' },
  ],
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
    });
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ sw }, use) => {
    await use(new URL(sw.url()).host);
  },
});

export const expect = test.expect;

export async function configure(sw: Worker, llmUrl: string, allowedOrigins: string[]) {
  await sw.evaluate(
    async ({ llmUrl, allowedOrigins }) => {
      // Wait for onInstalled to seed default profiles so it cannot overwrite ours afterwards.
      for (let i = 0; i < 100 && !(await chrome.storage.local.get('profiles')).profiles; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await chrome.storage.local.set({
        profiles: [
          { id: 'mock', name: 'Mock', baseUrl: llmUrl, apiKey: '', model: 'mock-model', supportsVision: false, contextMode: 'standard', contextWindow: 32000, maxScreenshots: 1 },
        ],
        settings: { activeProfileId: 'mock', stepLimit: 10, riskyKeywords: ['buy', 'delete'] },
        allowedOrigins,
      });
    },
    { llmUrl, allowedOrigins },
  );
}

export async function tabIdFor(sw: Worker, url: string): Promise<number> {
  return sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)!.id!, url);
}

/**
 * Opens the side panel UI as a page in its own window, so both it and the agent's tab stay
 * foreground (background tabs throttle rendering, which stalls Playwright's actionability checks).
 */
export async function openPanel(context: BrowserContext, sw: Worker, extensionId: string, tabId: number): Promise<Page> {
  const url = `chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`;
  const pagePromise = context.waitForEvent('page');
  await sw.evaluate(async (u) => {
    await chrome.windows.create({ url: u, width: 420, height: 800 });
  }, url);
  const panel = await pagePromise;
  await panel.waitForURL(/sidepanel\.html/);
  return panel;
}
