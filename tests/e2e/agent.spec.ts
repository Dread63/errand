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
  expect(servers.requests[0].tools).toHaveLength(16);
});

test('attaches a file the user dropped in the chat to the page, without an upload dialog', async ({ context, sw, extensionId, servers }) => {
  await configure(sw, servers.llmUrl, [servers.siteUrl]);
  servers.setScript([
    { name: 'attach_files', arguments: { files: ['invoice.txt'] }, content: 'Attaching the invoice.' },
    { name: 'done', arguments: { summary: 'Attached invoice.txt to the expense report.' } },
  ]);
  const page = await context.newPage();
  await page.goto(`${servers.siteUrl}/upload.html`);
  const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, page.url()));

  // The user drops the file into the chat; the agent never has to open the OS file chooser.
  await panel
    .locator('input[type=file]')
    .setInputFiles({ name: 'invoice.txt', mimeType: 'text/plain', buffer: Buffer.from('INVOICE #123') });
  await panel.getByTestId('composer-input').fill('Attach the receipt to this expense report');
  await panel.getByTestId('composer-send').click();

  // Attaching sends the user's files, so it asks before uploading.
  await panel.getByRole('button', { name: 'Approve' }).click();
  await expect(panel.getByText('Attached invoice.txt to the expense report.')).toBeVisible();
  await expect(page.locator('#status')).toHaveText('Received 1 file(s): invoice.txt (12 bytes)');
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

test('several form-field calls in one model reply run in order, and anything that may change the page ends the batch', async ({ context, sw, extensionId, servers }) => {
  await configure(sw, servers.llmUrl, [servers.siteUrl]);
  servers.setScript([
    {
      name: 'type',
      arguments: { id: 1, text: 'Ada Lovelace' },
      also: [
        { name: 'type', arguments: { id: 2, text: 'ada@example.com' } },
        { name: 'select', arguments: { id: 3, value: 'United Kingdom' } },
        { name: 'click', arguments: { id: 5 } }, // phone radio: does not change the page, so the batch goes on
        { name: 'scroll', arguments: { direction: 'down' } }, // may move things: ends the batch
        { name: 'type', arguments: { id: 7, text: 'must be skipped' } },
      ],
    },
    { name: 'done', arguments: { summary: 'Filled.' } },
  ]);
  const page = await context.newPage();
  await page.goto(`${servers.siteUrl}/signup.html`);
  const panel = await openPanel(context, sw, extensionId, await tabIdFor(sw, page.url()));

  await panel.getByTestId('composer-input').fill('Fill the form');
  await panel.getByTestId('composer-send').click();
  await expect(panel.getByText('Filled.')).toBeVisible();

  await expect(page.locator('[name=name]')).toHaveValue('Ada Lovelace');
  await expect(page.locator('[name=email]')).toHaveValue('ada@example.com');
  await expect(page.locator('[name=country]')).toHaveValue('uk');
  await expect(page.locator('[name=contact][value=phone]')).toBeChecked();
  await expect(page.locator('[name=message]')).toHaveValue('');
  expect(servers.requests).toHaveLength(2); // one reply filled four fields; the second only finished
});
