import { configure, expect, openPanel, tabIdFor, test } from './fixtures';

test('fills a form after site and risky-action approvals, with the overlay visible', async ({ context, sw, extensionId, servers }) => {
  await configure(sw, servers.llmUrl, []);
  servers.setScript([
    { name: 'type', arguments: { id: 1, text: 'Ada' }, content: 'Typing the name.' },
    { name: 'click', arguments: { id: 2 } },
    { name: 'done', arguments: { summary: 'Saved the form.' } },
  ]);
  const page = await context.newPage();
  await page.goto(`${servers.siteUrl}/form.html`);
  const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, page.url()));

  await panel.getByTestId('composer-input').fill('Enter the name Ada and save the form');
  await panel.getByTestId('composer-send').click();
  await panel.getByRole('button', { name: 'Allow once' }).click();
  await expect(panel.getByText('Clicking a submit button')).toBeVisible();
  await panel.getByRole('button', { name: 'Approve' }).click();

  await expect(panel.getByText('Saved the form.')).toBeVisible();
  await expect(page.locator('#out')).toHaveText('Saved: Ada');
  await expect(page.locator('#errand-overlay')).toHaveCount(1);
  expect(servers.requests[0].tools).toHaveLength(15);
});

test('a rejected risky action is not performed', async ({ context, sw, extensionId, servers }) => {
  await configure(sw, servers.llmUrl, [servers.siteUrl]);
  servers.setScript([
    { name: 'click', arguments: { id: 2 } },
    { name: 'done', arguments: { summary: 'Did not submit.' } },
  ]);
  const page = await context.newPage();
  await page.goto(`${servers.siteUrl}/form.html`);
  const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, page.url()));

  await panel.getByTestId('composer-input').fill('Submit the form');
  await panel.getByTestId('composer-send').click();
  await panel.getByRole('button', { name: 'Reject' }).click();

  await expect(panel.getByText('Did not submit.')).toBeVisible();
  await expect(page.locator('#out')).toHaveText('');
});

test('links that open new tabs join the Errand tab group', async ({ context, sw, extensionId, servers }) => {
  await configure(sw, servers.llmUrl, [servers.siteUrl]);
  servers.setScript([
    { name: 'click', arguments: { id: 1 } },
    { name: 'done', arguments: { summary: 'Opened the form.' } },
  ]);
  const page = await context.newPage();
  await page.goto(`${servers.siteUrl}/tabs.html`);
  const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, page.url()));

  await panel.getByTestId('composer-input').fill('Open the form');
  await panel.getByTestId('composer-send').click();
  await expect(panel.getByText('Opened the form.')).toBeVisible();

  const grouped = await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const groupIds = new Set(tabs.filter((t) => t.groupId !== -1).map((t) => t.groupId));
    return { urls: tabs.filter((t) => t.groupId !== -1).map((t) => new URL(t.url!).pathname).sort(), groups: groupIds.size };
  });
  expect(grouped).toEqual({ urls: ['/form.html', '/tabs.html'], groups: 1 });
  const secondRequest = JSON.stringify(servers.requests[1].messages);
  expect(secondRequest).toContain('form.html');
});

test('clicking an element hidden under an open menu reports the menu instead of succeeding', async ({ context, sw, extensionId, servers }) => {
  await configure(sw, servers.llmUrl, [servers.siteUrl]);
  servers.setScript([
    { name: 'click', arguments: { id: 1 } },
    { name: 'key', arguments: { combo: 'Escape' } },
    { name: 'click', arguments: { id: 1 } },
    { name: 'done', arguments: { summary: 'Selected.' } },
  ]);
  const page = await context.newPage();
  await page.goto(`${servers.siteUrl}/covered.html`);
  const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, page.url()));

  await panel.getByTestId('composer-input').fill('Tick the checkbox');
  await panel.getByTestId('composer-send').click();
  await expect(panel.getByText('Selected.')).toBeVisible();

  expect(JSON.stringify(servers.requests[1].messages)).toContain('is covered by listbox \\"Search options\\"');
  await expect(page.locator('#cb')).toHaveAttribute('aria-checked', 'true');
});
