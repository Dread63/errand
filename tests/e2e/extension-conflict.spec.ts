import { configure, expect, openPanel, tabIdFor, test } from './fixtures';

test.use({ withFrameInjector: true });

test("works on pages where another extension keeps a hidden frame, and restores it afterwards", async ({ context, sw, extensionId, servers }) => {
  await configure(sw, servers.llmUrl, [servers.siteUrl]);
  servers.setScript([
    { name: 'type', arguments: { id: 1, text: 'Ada' } },
    { name: 'click', arguments: { id: 2 } },
    { name: 'done', arguments: { summary: 'Saved despite the other extension.' } },
  ]);
  const page = await context.newPage();
  await page.goto(`${servers.siteUrl}/form.html`);
  await expect(page.locator('#injector-frame')).toHaveCount(1);
  const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, page.url()));

  await panel.getByTestId('composer-input').fill('Enter Ada and save');
  await panel.getByTestId('composer-send').click();
  await panel.getByRole('button', { name: 'Approve' }).click();

  await expect(panel.getByText('Saved despite the other extension.')).toBeVisible();
  await expect(page.locator('#out')).toHaveText('Saved: Ada');
  await expect(page.locator('#injector-frame')).toHaveCount(1);
});
