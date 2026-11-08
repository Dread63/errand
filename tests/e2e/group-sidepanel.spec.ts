import { expect, tabIdFor, test } from './fixtures';

test('panel eligibility follows live Errand group membership and titles', async ({ context, sw }) => {
  const first = await context.newPage();
  await first.goto('about:blank#first');
  const second = await context.newPage();
  await second.goto('about:blank#second');
  const firstId = await tabIdFor(sw, first.url());
  const secondId = await tabIdFor(sw, second.url());
  const enabled = (tabId: number) => sw.evaluate(async (id) => (await chrome.sidePanel.getOptions({ tabId: id })).enabled, tabId);

  await expect.poll(() => sw.evaluate(async () => (await chrome.sidePanel.getOptions({})).enabled)).toBe(false);
  await expect.poll(() => enabled(firstId)).toBe(false);
  const groupId = await sw.evaluate(async (id) => {
    const groupId = await chrome.tabs.group({ tabIds: [id] });
    await chrome.tabGroups.update(groupId, { title: 'Errand', color: 'purple' });
    return groupId;
  }, firstId);
  await expect.poll(() => enabled(firstId)).toBe(true);
  await expect.poll(() => enabled(secondId)).toBe(false);

  await sw.evaluate(async ({ groupId, secondId }) => { await chrome.tabs.group({ tabIds: [secondId], groupId }); }, { groupId, secondId });
  await expect.poll(() => enabled(secondId)).toBe(true);
  await sw.evaluate(async (id) => { await chrome.tabs.ungroup(id); }, firstId);
  await expect.poll(() => enabled(firstId)).toBe(false);

  await sw.evaluate(async (id) => { await chrome.tabGroups.update(id, { title: 'Other' }); }, groupId);
  await expect.poll(() => enabled(secondId)).toBe(false);
  await sw.evaluate(async (id) => { await chrome.tabGroups.update(id, { title: 'Errand' }); }, groupId);
  await expect.poll(() => enabled(secondId)).toBe(true);
  await sw.evaluate(async (id) => { await chrome.tabs.ungroup(id); }, secondId);
  await expect.poll(() => enabled(secondId)).toBe(false);
});

test('Chrome accepts enable then open without awaiting in a user gesture', async ({ context, sw, extensionId }) => {
  // Playwright cannot click Chrome's toolbar. Exercise the same API ordering
  // with a real click on an extension page, which also grants a user gesture.
  const target = await context.newPage();
  await target.goto('about:blank#gesture');
  const tabId = await tabIdFor(sw, target.url());
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.evaluate((id) => {
    const button = document.createElement('button');
    button.textContent = 'Test panel gesture';
    button.onclick = () => {
      const enabled = chrome.sidePanel.setOptions({ tabId: id, path: 'sidepanel.html', enabled: true });
      const opened = chrome.sidePanel.open({ tabId: id });
      void Promise.all([enabled, opened]).then(
        () => { button.textContent = 'Panel opened'; },
        (error) => { button.textContent = `Failed: ${error.message}`; },
      );
    };
    document.body.append(button);
  }, tabId);
  await options.getByRole('button', { name: 'Test panel gesture' }).click();
  await expect(options.getByRole('button', { name: 'Panel opened' })).toBeVisible();
});
