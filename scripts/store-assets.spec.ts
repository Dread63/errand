// Generates the Chrome Web Store screenshots (1280×800) in docs/store. Run: npm run store-assets.
// Uses the e2e harness: the built extension, plus the scripted mock model from tests/e2e/servers.ts.
// Demo sites are served from scripts/store-pages through request routing.
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { openPanel, tabIdFor, test } from '../tests/e2e/fixtures';
import { DEFAULT_RISKY_KEYWORDS } from '../src/lib/storage/settings';

const SITE = 'http://fieldnote.example';
const SHOP = 'http://kettle.example';
const OUT = 'docs/store';
const PAGE_W = 860;
const PANEL_W = 420;
const H = 800;

async function serveDemoSites(context: BrowserContext) {
  for (const origin of [SITE, SHOP]) {
    await context.route(`${origin}/**`, async (route) => {
      const name = path.basename(new URL(route.request().url()).pathname);
      const body = await readFile(path.join('scripts/store-pages', name));
      await route.fulfill({ body, contentType: name.endsWith('.css') ? 'text/css' : 'text/html' });
    });
  }
}

/** Two providers with realistic model lists; requests actually go to the mock model. */
async function setUp(sw: Worker, llmUrl: string, allowedOrigins: string[]) {
  await sw.evaluate(
    async ({ llmUrl, allowedOrigins, risky }) => {
      const base = { apiKey: '', contextMode: 'full', contextWindow: 128000, maxScreenshots: 2 };
      await chrome.storage.local.set({
        profiles: [
          { ...base, id: 'openrouter', name: 'OpenRouter', baseUrl: llmUrl, model: 'openai/gpt-4o-mini', supportsVision: true },
          { ...base, id: 'ollama', name: 'Ollama (local)', baseUrl: llmUrl, model: 'qwen3:14b', supportsVision: false, contextMode: 'compact', contextWindow: 32768 },
        ],
        settings: { activeProfileId: 'openrouter', stepLimit: 30, riskyKeywords: risky, debugTiming: false, theme: 'light' },
        allowedOrigins,
        modelCatalog: {
          openrouter: { fetchedAt: Date.now(), models: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'qwen/qwen3-235b-a22b', 'meta-llama/llama-4-maverick'] },
          ollama: { fetchedAt: Date.now(), models: ['qwen3:14b', 'llama3.2:3b'] },
        },
      });
    },
    { llmUrl, allowedOrigins, risky: DEFAULT_RISKY_KEYWORDS },
  );
}

async function openSite(context: BrowserContext, sw: Worker, extensionId: string, url: string) {
  const page = await context.newPage();
  await page.setViewportSize({ width: PAGE_W, height: H });
  await page.goto(url);
  const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, url));
  await panel.setViewportSize({ width: PANEL_W, height: H });
  return { page, panel };
}

async function compose(context: BrowserContext, page: Page, panel: Page, file: string) {
  const shot = async (p: Page) => `data:image/png;base64,${(await p.screenshot()).toString('base64')}`;
  const [left, right] = [await shot(page), await shot(panel)];
  const out = await context.newPage();
  await out.setViewportSize({ width: PAGE_W + PANEL_W, height: H });
  await out.setContent(
    `<body style="margin:0;display:flex;background:#fff"><img src="${left}" width="${PAGE_W - 1}" height="${H}" style="object-fit:cover;object-position:left top">` +
      `<div style="width:1px;background:#dcdce3"></div><img src="${right}" width="${PANEL_W}" height="${H}"></body>`,
  );
  await out.screenshot({ path: `${OUT}/${file}` });
  await out.close();
}

test.beforeEach(async ({ context }) => serveDemoSites(context));

test('1: a task in progress', async ({ context, sw, extensionId, servers }) => {
  await setUp(sw, servers.llmUrl, [SITE]);
  servers.setScript([
    { name: 'type', arguments: { id: 1, text: 'Ada Lovelace' }, content: "I'll fill in the trial form with your details." },
    { name: 'type', arguments: { id: 2, text: 'ada@analytical.co' } },
    { name: 'type', arguments: { id: 3, text: 'Analytical Engines' } },
    { name: 'wait', arguments: { ms: 10000 }, content: 'Next I’ll choose the Team plan and start the trial.' },
  ]);
  const { page, panel } = await openSite(context, sw, extensionId, `${SITE}/signup.html`);
  await panel.getByTestId('composer-input').fill('Sign me up for a Fieldnote trial on the Team plan. I’m Ada Lovelace, ada@analytical.co, at Analytical Engines.');
  await panel.getByTestId('composer-send').click();
  await page.waitForFunction(() => (document.querySelector('input[name=company]') as HTMLInputElement).value === 'Analytical Engines');
  await panel.waitForTimeout(1200);
  await compose(context, page, panel, 'screenshot-1-task.png');
});

test('2: approval before a risky action', async ({ context, sw, extensionId, servers }) => {
  await setUp(sw, servers.llmUrl, [SHOP]);
  servers.setScript([{ name: 'click', arguments: { id: 1 }, content: 'Your cart has the kettle and the pan, $56.50 in total. Placing the order now.' }]);
  const { page, panel } = await openSite(context, sw, extensionId, `${SHOP}/checkout.html`);
  await panel.getByTestId('composer-input').fill('Check out my cart if the total is under $60');
  await panel.getByTestId('composer-send').click();
  await panel.getByRole('button', { name: 'Approve' }).waitFor();
  await panel.waitForTimeout(600);
  await compose(context, page, panel, 'screenshot-2-approval.png');
});

test('3: any model, hosted or local', async ({ context, sw, extensionId, servers }) => {
  await setUp(sw, servers.llmUrl, [SITE]);
  const { page, panel } = await openSite(context, sw, extensionId, `${SITE}/signup.html`);
  await panel.getByRole('button', { name: 'Model' }).click();
  await panel.getByRole('option', { name: /qwen3:14b/ }).waitFor();
  await panel.waitForTimeout(300);
  await compose(context, page, panel, 'screenshot-3-models.png');
});

test('4: provider presets', async ({ context, sw, extensionId, servers }) => {
  await setUp(sw, servers.llmUrl, []);
  const options = await context.newPage();
  await options.setViewportSize({ width: PAGE_W + PANEL_W, height: H });
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByRole('button', { name: 'Add provider' }).click();
  await options.getByRole('button', { name: 'Ollama (local)' }).waitFor();
  await options.screenshot({ path: `${OUT}/screenshot-4-settings.png` });
});
