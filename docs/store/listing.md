# Chrome Web Store listing

Everything to paste into the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) for Errand. Keep this file in sync with `wxt.config.ts` and `PRIVACY.md`.

## Store listing tab

**Name** (from the manifest): Errand — AI browser agent

**Summary** (from the manifest `description`, max 132 characters):

> An AI agent that browses for you in a side panel. Bring any OpenAI-compatible model: OpenAI, OpenRouter, Ollama and more.

**Category:** Productivity → Tools (alternative: Developer Tools)

**Language:** English

**Description:**

```
Errand is an AI agent that does web tasks for you, right in your browser.

Tell it what you need in the side panel: "fill in this form from my notes", "compare these two products", "copy the table from this page into a spreadsheet". Errand reads the page, moves a visible cursor, clicks and types, and reports back. You watch every step and can stop it at any time.

BRING YOUR OWN MODEL
Errand works with any OpenAI-compatible API. Use OpenAI or OpenRouter, or keep everything on your own machine with Ollama or LM Studio. Built-in presets fill in the details; paste a key, test the connection and pick a model. There is no Errand account and no subscription.

YOU STAY IN CONTROL
• Errand works only in its own purple "Errand" tab group.
• It asks before working on a site for the first time (allow once, always, or deny).
• It asks before risky actions: purchases, submissions, deletions, password fields and downloads. You choose which words count as risky.
• A live cursor and highlights show exactly what it is about to do.
• Stop ends the task immediately.

PRIVATE BY DESIGN
Errand has no servers, analytics or telemetry. Settings, keys and chat history stay on your device. Page content is sent only to the model provider you choose, and with a local model it never leaves your computer.

FEATURES
• Attach images, PDFs and text files to a task
• Works across multiple tabs
• Chat history stored locally
• Light and dark themes
• Free and open source (AGPL-3.0): https://github.com/Dread63/errand

Note: while a task runs, Chrome shows a "started debugging this browser" bar. That is how Errand sends real clicks and keystrokes; closing the bar pauses the task.
```

**Graphic assets:**

| Asset | File |
|---|---|
| Store icon (128×128) | `public/icon/128.png` |
| Screenshots (1280×800) | `docs/store/screenshot-1-task.png`, `screenshot-2-approval.png`, `screenshot-3-models.png`, `screenshot-4-settings.png` |
| Small promo tile (440×280) | `docs/store/promo-440x280.png` |

**Additional fields:**
- Homepage URL: `https://github.com/Dread63/errand`
- Support URL: `https://github.com/Dread63/errand/issues`

## Privacy tab

**Single purpose:**

> Errand performs web tasks the user asks for, in the user's browser, using a language model the user configures.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `debugger` | Errand uses the Chrome DevTools Protocol to send trusted mouse and keyboard input (Input.dispatchMouseEvent / dispatchKeyEvent) and to capture screenshots of the page (Page.captureScreenshot), so the agent can click, type and see pages the way a person does. Many sites ignore synthetic DOM events, so ordinary content-script events are not enough. It attaches only to tabs in Errand's own tab group, only while a user-started task is running, and Chrome shows its "started debugging this browser" bar the whole time. |
| Host permission `<all_urls>` and the content script | The user decides which sites a task needs, so the agent must be able to work on any site. The content script reads the page's structure (a compact snapshot of interactive elements and text) and draws the cursor and highlights. It is passive until the agent works in that tab, and the user must approve each new site in the side panel before Errand acts on it. The host permission also lets Errand call the model endpoint the user configures, which can be any URL, including localhost. |
| `scripting` | Re-injects Errand's own bundled content script into a tab that was open before Errand was installed or updated, so the agent can work in it without the user reloading the page. No remote or dynamically generated code is injected. |
| `tabs` | Finds the user's current tab to start a task, follows tabs the agent opens (e.g. links that open in a new tab), switches between them, and reads their URLs and titles to show the agent which tabs it is working in. |
| `tabGroups` | Puts the tabs the agent controls into a labelled "Errand" tab group, so the user can always see which tabs the agent can touch. |
| `sidePanel` | Errand's interface (chat, approvals, Stop) lives in the browser side panel. |
| `storage` | Stores the user's provider settings, preferences, allowed sites and chat history locally on the device. |
| `unlimitedStorage` | Chat history can include attached images and PDFs, which can exceed the default 10 MB local storage quota. |

**Are you using remote code?** No, I am not using remote code. All JavaScript is bundled in the package. Responses from the language model are treated as data (tool calls with arguments), never executed as code.

**Data usage**: tick these data types:
- **Personally identifiable information**: only if it appears in pages or messages the user asks the agent to work with. Tick it to be safe.
- **Authentication information**: the user's own API keys for their model provider, stored locally.
- **Personal communications**: if the user's task involves email or messages.
- **Website content**: page text, structure and screenshots.
- **User activity**: the agent's clicks and keystrokes during a task.

Leave unticked: health information, financial and payment information, location, web history.

**Certify all three:**
- I do not sell or transfer user data to third parties, apart from the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://github.com/Dread63/errand/blob/main/PRIVACY.md`

## Distribution tab

- Visibility: Public
- Regions: All regions

## Test instructions (for reviewers)

Paste this into the dashboard's **Test instructions** field and fill in a real key there. **Never commit the key.** Use a key with a low spending cap (OpenRouter lets you set a credit limit per key).

```
1. Click the Errand toolbar icon to open the side panel. It shows "Connect a model to get started".
2. Click "Open Settings" → "Add provider" → "OpenRouter".
3. Paste this API key: <KEY>
4. Click "Test connection", then type or pick the model: openai/gpt-4o-mini
5. Click Save, then go back to any web page (e.g. https://en.wikipedia.org/wiki/Special:Random).
6. In the side panel, type: "Summarise this page in three bullet points" and press Send.
7. Approve the site when asked. Errand moves its tab into an "Errand" tab group, reads the page and replies. Chrome shows its debugging bar while the task runs; this is expected.
8. Try a task with a risky action (e.g. on a search page, "search for 'chrome extensions' and click the first result") to see the approval prompts. Press Stop at any time to end a task.
```
