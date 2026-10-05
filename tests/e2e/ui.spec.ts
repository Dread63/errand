import { configure, expect, openPanel, tabIdFor, test } from './fixtures';

test('renders the final answer as markdown and collapses the activity card', async ({ context, sw, extensionId, servers }) => {
  await configure(sw, servers.llmUrl, [servers.siteUrl]);
  servers.setScript([
    { name: 'wait', arguments: { ms: 1 } },
    { name: 'done', arguments: { summary: '**Found 2 items**\n\n- Apple\n- Pear\n\n| a | b |\n|---|---|\n| 1 | 2 |' } },
  ]);
  const page = await context.newPage();
  await page.goto(`${servers.siteUrl}/form.html`);
  const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, page.url()));

  await expect(panel.getByText('What should I do in this tab?')).toBeVisible();
  await panel.getByTestId('composer-input').fill('List fruit');
  await panel.getByTestId('composer-send').click();

  await expect(panel.locator('.md strong', { hasText: 'Found 2 items' })).toBeVisible();
  await expect(panel.locator('.md li')).toHaveCount(2);
  await expect(panel.locator('.md table')).toBeVisible();
  const head = panel.getByRole('button', { name: /Worked through 2 steps/ });
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await head.click();
  await expect(panel.getByText('Finished')).toBeVisible();
});

test('picks a model from the menu and uses it for the next task', async ({ context, sw, extensionId, servers }) => {
  await configure(sw, servers.llmUrl, [servers.siteUrl]);
  servers.setScript([{ name: 'done', arguments: { summary: 'Used the second model.' } }]);
  const page = await context.newPage();
  await page.goto(`${servers.siteUrl}/form.html`);
  const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, page.url()));

  await panel.getByRole('button', { name: 'Model' }).click();
  await panel.getByRole('option', { name: /mock-model-2/ }).click();
  await expect(panel.getByRole('button', { name: 'Model' })).toContainText('Mock Model 2');

  await panel.getByTestId('composer-input').fill('Go');
  await panel.getByTestId('composer-send').click();
  await expect(panel.getByText('Used the second model.')).toBeVisible();
  expect(servers.requests[0].model).toBe('mock-model-2');
});

test('files dropped anywhere on the panel are attached', async ({ context, sw, extensionId, servers }) => {
  await configure(sw, servers.llmUrl, [servers.siteUrl]);
  const page = await context.newPage();
  await page.goto(`${servers.siteUrl}/form.html`);
  const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, page.url()));
  await panel.locator('.chat').evaluate((chat) => {
    const dt = new DataTransfer();
    dt.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    for (const type of ['dragenter', 'dragover', 'drop']) chat.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(panel.getByRole('button', { name: 'Remove notes.txt' })).toBeVisible();
  await expect(panel.locator('.dropzone')).toHaveCount(0);
});
