import type { Page, Worker } from '@playwright/test';
import fs from 'node:fs';
import { configure, expect, openPanel, tabIdFor, test } from '../e2e/fixtures';

/**
 * Multi-step tasks run by a real model against local pages, checked by their end state.
 * Each task runs once per reasoning effort in LIVE_EFFORTS (default: "default,low").
 *
 *   npm run test:live:e2e
 *   LIVE_MODEL=glm-5.3-flash LIVE_EFFORTS=low npm run test:live:e2e
 */
const KEY = process.env.OPEN_CODE_GO_API_KEY;
const MODEL = process.env.LIVE_MODEL ?? 'glm-5.3-flash';
const BASE_URL = process.env.LIVE_BASE_URL ?? 'https://opencode.ai/zen/go/v1';
const EFFORTS = (process.env.LIVE_EFFORTS ?? 'default,low').split(',').map((s) => s.trim());

interface Task {
  name: string;
  page: string;
  prompt: (site: string) => string;
  check: (page: Page, answer: string) => Promise<void>;
}

const sheetData = (page: Page) =>
  page.evaluate(() => (window as unknown as { sheetData(): Record<string, { raw: string; value: unknown }> }).sheetData());

const TASKS: Task[] = [
  {
    name: 'spreadsheet budget',
    page: 'sheet.html',
    prompt: () =>
      'In this spreadsheet, make a monthly budget. Row 1 has the headers Item and Cost. Then add Rent 1200, Groceries 450 and Utilities 180, ' +
      'and below them a Total row whose cost is a formula adding up the three costs.',
    check: async (page) => {
      const cells = Object.values(await sheetData(page));
      const raws = cells.map((c) => c.raw.toLowerCase());
      for (const word of ['item', 'cost', 'rent', 'groceries', 'utilities', 'total']) expect(raws).toContain(word);
      const formula = cells.find((c) => c.raw.startsWith('='));
      expect(formula, 'a formula cell').toBeTruthy();
      expect(formula!.value).toBe(1830);
    },
  },
  {
    name: 'signup form',
    page: 'signup.html',
    prompt: () =>
      'Fill out this sign-up form: name Ada Lovelace, email ada@example.com, country United Kingdom, preferred contact Phone, ' +
      'subscribe to the newsletter, message "Hello from the agent". Then create the account.',
    check: async (page) => {
      const out = JSON.parse((await page.locator('#out').textContent()) || '{}');
      expect(out).toEqual({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        country: 'uk',
        contact: 'phone',
        newsletter: true,
        message: 'Hello from the agent',
      });
    },
  },
  {
    name: 'compare across tabs',
    page: 'shop-a.html',
    prompt: (site) =>
      `This tab is Shop A. Open Shop B at ${site}/shop-b.html in a new tab and compare the price of the Blue Kettle in both shops. ` +
      'Tell me which shop is cheaper and by how much.',
    check: async (_page, answer) => {
      expect(answer).toMatch(/shop b/i);
      expect(answer).toMatch(/7\.25/);
    },
  },
];

interface Result {
  task: string;
  effort: string;
  passed: boolean;
  seconds: number;
  steps: number;
  modelSeconds: number;
  slowestModelSeconds: number;
  reasoningChars: number;
  gates: string[];
}
/** Appended per test, so the summary survives Playwright restarting its worker after a failure. */
const RESULTS_FILE = 'test-results/live-results.jsonl';

/** Answers approval prompts the way a cooperative user would on these local test pages. */
async function driveGates(panel: Page, gates: string[], deadline: number): Promise<void> {
  let retries = 0;
  await panel.getByTestId('composer-stop').waitFor({ timeout: 10_000 }).catch(() => {});
  // The stop button can blink out between steps, so "finished" means it stayed hidden for a while.
  let hiddenSince = 0;
  for (;;) {
    if (Date.now() >= deadline) break;
    const dialog = panel.getByRole('dialog').first();
    const gated = await dialog.isVisible().catch(() => false);
    if (gated || (await panel.getByTestId('composer-stop').isVisible())) hiddenSince = 0;
    else if ((hiddenSince ||= Date.now()) && Date.now() - hiddenSince > 1_500) break;

    if (gated) {
      // Short timeouts: a gate can close or be replaced between reading it and clicking, and a
      // blocked click must not eat the whole test budget. The loop simply looks again.
      const t = { timeout: 5_000 };
      try {
        const label = (await dialog.getAttribute('aria-label', t)) ?? '';
        const text = (await dialog.innerText(t)).replace(/\s+/g, ' ').slice(0, 160);
        if (label === 'Site permission') await dialog.getByRole('button', { name: 'Allow once' }).click(t);
        else if (label === 'Approve action') await dialog.getByRole('button', { name: 'Approve' }).click(t);
        else if (label === 'Question from the agent') {
          await dialog.getByRole('textbox').fill('Use your best judgement with the details already given.', t);
          await dialog.getByRole('button', { name: 'Send answer' }).click(t);
        } else await dialog.getByRole('button', { name: retries++ < 1 ? 'Retry' : 'Stop' }).click(t);
        gates.push(`${label}: ${text}`);
      } catch (e) {
        gates.push(`(gate click failed, retrying: ${String(e).split('\n')[0].slice(0, 120)})`);
      }
      continue;
    }
    await panel.waitForTimeout(250);
  }
  if (await panel.getByTestId('composer-stop').isVisible()) await panel.getByTestId('composer-stop').click();
}

function collectTimings(sw: Worker) {
  const lines: string[] = [];
  sw.on('console', (m) => {
    if (m.text().startsWith('[timing]')) lines.push(m.text());
  });
  return (name = '') => {
    if (name) {
      fs.mkdirSync('test-results', { recursive: true });
      fs.writeFileSync(`test-results/timing-${name.replace(/\W+/g, '-')}.log`, lines.join('\n'));
    }
    const model = lines.map((l) => /step \d+: model \(total.*?\): (\d+)ms/.exec(l)).filter((m) => !!m).map((m) => Number(m[1]) / 1000);
    const reasoning = lines.map((l) => /first reasoning token \((\d+) chars/.exec(l)).filter((m) => !!m).map((m) => Number(m[1]));
    return {
      steps: model.length,
      modelSeconds: model.reduce((a, b) => a + b, 0),
      slowestModelSeconds: Math.max(0, ...model),
      reasoningChars: reasoning.reduce((a, b) => a + b, 0),
    };
  };
}

test.describe('live agent tasks', () => {
  test.skip(!KEY, 'Set OPEN_CODE_GO_API_KEY in .env.local to run live tasks.');

  test.afterAll(() => {
    if (!fs.existsSync(RESULTS_FILE)) return;
    const results = fs
      .readFileSync(RESULTS_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Result);
    const rows = results.map(
      (r) =>
        `${r.passed ? 'PASS' : 'FAIL'}  ${r.task.padEnd(20)} ${r.effort.padEnd(8)} ${r.seconds.toFixed(1).padStart(6)}s  ${String(r.steps).padStart(3)} steps  ` +
        `model ${r.modelSeconds.toFixed(1).padStart(6)}s (slowest ${r.slowestModelSeconds.toFixed(1)}s)  reasoning ${r.reasoningChars} chars`,
    );
    console.log(`\nLive results (${MODEL})\n${rows.join('\n')}`);
    fs.writeFileSync('test-results/live-summary.json', JSON.stringify({ model: MODEL, results }, null, 2));
  });

  for (const effort of EFFORTS) {
    for (const task of TASKS) {
      test(`${task.name} [${effort}]`, async ({ context, sw, extensionId, servers }) => {
        await configure(sw, servers.llmUrl, [servers.siteUrl], {
          baseUrl: BASE_URL,
          apiKey: KEY,
          model: MODEL,
          supportsVision: true,
          contextWindow: 128_000,
          ...(effort === 'default' ? {} : { reasoningEffort: effort }),
        });
        await sw.evaluate(async () => {
          const { settings } = (await chrome.storage.local.get('settings')) as { settings: object };
          await chrome.storage.local.set({ settings: { ...settings, stepLimit: 25, debugTiming: true } });
        });
        const timings = collectTimings(sw);
        const page = await context.newPage();
        await page.goto(`${servers.siteUrl}/${task.page}`);
        const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, page.url()));
        await panel.getByTestId('composer-input').fill(task.prompt(servers.siteUrl));

        const gates: string[] = [];
        const t0 = Date.now();
        await panel.getByTestId('composer-send').click();
        await driveGates(panel, gates, t0 + 300_000);
        const seconds = (Date.now() - t0) / 1000;

        const answer = (await panel.locator('.chat .md').last().textContent({ timeout: 2_000 }).catch(() => '')) ?? '';
        const result: Result = { task: task.name, effort, passed: false, seconds, ...timings(`${task.name}-${effort}`), gates };
        const { steps } = result;
        console.log(`[${task.name} / ${effort}] ${seconds.toFixed(1)}s, ${steps} steps. Answer: ${answer.slice(0, 300)}`);
        for (const g of gates) console.log(`  gate: ${g}`);

        try {
          await task.check(page, answer);
          result.passed = true;
        } finally {
          fs.mkdirSync('test-results', { recursive: true });
          fs.appendFileSync(RESULTS_FILE, `${JSON.stringify(result)}\n`);
        }
      });
    }
  }
});
