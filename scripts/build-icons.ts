// Regenerates the Errand logo files: src/assets/logo.svg, public/icon/*.png and the store promo
// tile. Run with `npm run icons`; the outputs are committed, so builds don't need this.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { logoSvg } from '../src/lib/ui/logo.ts';

const ICONS = [
  { size: 16, small: true, safe: 124 },
  { size: 32, small: true, safe: 120 },
  { size: 48, small: false, safe: 112 },
  { size: 128, small: false, safe: 96 },
];

await mkdir('src/assets', { recursive: true });
await mkdir('public/icon', { recursive: true });
await mkdir('docs/store', { recursive: true });
await writeFile('src/assets/logo.svg', logoSvg({ safe: 120 }) + '\n');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { size, small, safe } of ICONS) {
  await page.setContent(`<body style="margin:0;background:transparent">${logoSvg({ size, small, safe })}</body>`);
  await page.locator('svg').screenshot({ path: `public/icon/${size}.png`, omitBackground: true });
}

await page.setViewportSize({ width: 440, height: 280 });
await page.setContent(`<body style="margin:0;width:440px;height:280px;display:flex;align-items:center;justify-content:center;gap:22px;
  background:#faf9ff;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
  ${logoSvg({ size: 120, safe: 120 })}
  <div><div style="font-size:56px;font-weight:650;color:#18181b;letter-spacing:-1px">Errand</div>
  <div style="font-size:22px;color:#71717a;margin-top:2px">AI browser agent</div></div></body>`);
await page.screenshot({ path: 'docs/store/promo-440x280.png' });
await browser.close();
console.log('Wrote src/assets/logo.svg, public/icon/{16,32,48,128}.png, docs/store/promo-440x280.png');
