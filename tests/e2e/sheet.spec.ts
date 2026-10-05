import type { Page } from '@playwright/test';
import { configure, expect, openPanel, tabIdFor, test } from './fixtures';

const VISION = { supportsVision: true };

async function cellCenter(page: Page, cell: string): Promise<{ x: number; y: number }> {
  const b = (await page.locator(`[data-cell="${cell}"]`).boundingBox())!;
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}

const sheetData = (page: Page) => page.evaluate(() => (window as unknown as { sheetData(): Record<string, { raw: string; value: unknown }> }).sheetData());

/** Width and height from a base64 JPEG data URL's SOF marker. */
function jpegSize(dataUrl: string): { w: number; h: number } {
  const b = Buffer.from(dataUrl.split(',')[1], 'base64');
  for (let i = 2; i < b.length; ) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error('no SOF marker');
}

type ImagePart = { type: string; image_url?: { url: string } };
const lastScreenshot = (messages: unknown[]): string => {
  const parts = (messages.at(-1) as { content: ImagePart[] }).content;
  return parts.find((p) => p.type === 'image_url')!.image_url!.url;
};

test('fills a spreadsheet: clicks a cell by coordinates and types a whole table in one call', async ({ context, sw, extensionId, servers }) => {
  await configure(sw, servers.llmUrl, [servers.siteUrl], VISION);
  const page = await context.newPage();
  await page.goto(`${servers.siteUrl}/sheet.html`);
  const a1 = await cellCenter(page, 'A1');
  const d2 = await cellCenter(page, 'D2');
  servers.setScript([
    { name: 'click', arguments: { ...a1 } },
    { name: 'type', arguments: { text: 'Item\tCost\nRent\t1200\nFood\t450\nTotal\t=SUM(B2:B3)\n' } },
    { name: 'click', arguments: { ...d2 } },
    // The old failure: "+" could not be pressed and Shift+= typed "=".
    { name: 'key', arguments: { combo: '=' } },
    { name: 'key', arguments: { combo: '1' } },
    { name: 'key', arguments: { combo: '+' } },
    { name: 'key', arguments: { combo: '2' } },
    { name: 'key', arguments: { combo: 'Shift+=' } },
    { name: 'key', arguments: { combo: '3' } },
    { name: 'key', arguments: { combo: 'Enter' } },
    { name: 'done', arguments: { summary: 'Budget entered.' } },
  ]);
  const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, page.url()));
  await panel.getByTestId('composer-input').fill('Make a small budget');
  await panel.getByTestId('composer-send').click();
  await expect(panel.getByText('Budget entered.')).toBeVisible({ timeout: 30_000 });

  const data = await sheetData(page);
  expect(data).toMatchObject({
    A1: { raw: 'Item' },
    B1: { raw: 'Cost' },
    A2: { raw: 'Rent' },
    B2: { value: 1200 },
    A3: { raw: 'Food' },
    B3: { value: 450 },
    A4: { raw: 'Total' },
    B4: { raw: '=SUM(B2:B3)', value: 1650 },
    D2: { raw: '=1+2+3', value: 6 },
  });

  // The vision model was offered coordinates, told the screenshot size, and saw the cells.
  const click = (servers.requests[0].tools as Array<{ function: { name: string; parameters: { properties: object } } }>).find(
    (t) => t.function.name === 'click',
  )!;
  expect(click.function.parameters.properties).toHaveProperty('x');
  expect(JSON.stringify(servers.requests[0].messages)).toContain('Screenshot: ');
  // The finished task's steps are collapsed into one activity card; one click shows them.
  await panel.getByRole('button', { name: /Worked through \d+ steps/ }).click();
  await expect(panel.getByText('Type "Item⇥Cost⏎Rent⇥1200⏎Food⇥450⏎Total⇥=SUM(B2:B3)⏎" into textbox')).toBeVisible();
});

test.describe('on a high-DPI screen', () => {
  test.use({ screenScale: 2 });

  test('screenshots are scaled to CSS pixels so coordinates land on the right cell', async ({ context, sw, extensionId, servers }) => {
    await configure(sw, servers.llmUrl, [servers.siteUrl], VISION);
    const page = await context.newPage();
    await page.goto(`${servers.siteUrl}/sheet.html`);
    const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
    expect(viewport.dpr).toBe(2);
    const c3 = await cellCenter(page, 'C3');
    servers.setScript([
      { name: 'click', arguments: { ...c3 } },
      { name: 'type', arguments: { text: 'hi\n' } },
      { name: 'done', arguments: { summary: 'Typed.' } },
    ]);
    const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, page.url()));
    await panel.getByTestId('composer-input').fill('Type hi in C3');
    await panel.getByTestId('composer-send').click();
    await expect(panel.getByText('Typed.')).toBeVisible();

    expect(jpegSize(lastScreenshot(servers.requests[0].messages))).toEqual({ w: viewport.w, h: viewport.h });
    expect(await sheetData(page)).toEqual({ C3: { raw: 'hi', value: 'hi' } });
  });
});
