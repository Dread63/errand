# browser-control

A Chrome extension that gives you a side-panel browsing agent — live cursor, highlights, and approvals — powered by any OpenAI-compatible model: your local models via MTPLX over Tailscale, or hosted models via OpenCode Go.

Design: [`docs/superpowers/specs/2026-10-04-browser-agent-extension-design.md`](docs/superpowers/specs/2026-10-04-browser-agent-extension-design.md)

## Install

```bash
npm install
npm run build
```

In Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → choose `.output/chrome-mv3`. Pin the extension and click its icon to open the side panel. Repeat on every machine where you want it (or run `npm run zip` and copy the zip).

## Configure models

Open Settings (gear icon in the panel header).

**MacBook (MTPLX over Tailscale)**
1. On the MacBook, start MTPLX listening on all interfaces (or the Tailscale IP), not only `127.0.0.1`.
2. Set the profile's Base URL to `http://<macbook-name>.<tailnet>.ts.net:<port>/v1`. API key can stay empty unless MTPLX requires one.
3. Press **Test connection** and pick the model id it lists.
4. Keep **Context mode: Compact** for Qwen 3.6 35B A3B / Qwen 3.8 27B. Turn on **Supports images** only if your MTPLX build accepts `image_url` inputs.

**OpenCode Go**
1. Base URL `https://opencode.ai/zen/go/v1`, paste your API key.
2. **Test connection**, pick e.g. the GLM 5.3 Flash id it lists.
3. **Context mode: Full**, context window `1000000`.
4. **Reasoning effort: Low** for fast steps. With the model default, GLM thinks for up to minutes per step; Low and Medium turn thinking off on OpenCode Go.

## Using it

- Type a task, optionally attach images, PDFs or text files (paperclip, drag-drop or paste), pick a model from the menu in the input box, press **Send**.
- The agent works in a purple **Agent** tab group. It asks before touching a new site (Allow once / Always allow / Deny) and before risky actions (submits, purchases, passwords, downloads). **Stop** ends the task immediately.
- Chrome shows a "started debugging this browser" bar while the agent runs — that is how it sends real clicks. Closing that bar pauses the task.
- Theme: System / Light / Dark in Settings → General.
- Past chats are under **History** (stored only on this device; screenshots are not saved).

## Develop

```bash
npm run dev        # WXT dev mode with reload
npm test           # unit tests (Vitest)
npm run test:e2e   # builds, then runs Playwright against the real extension
npm run test:live:e2e  # real-model tasks (spreadsheet, form, multi-tab); needs OPEN_CODE_GO_API_KEY in .env.local
npm run compile    # type-check
```

`test:live:e2e` runs each task with reasoning effort `default` and `low` (override with `LIVE_EFFORTS=low`, `LIVE_MODEL=…`) and prints a pass/fail and timing table. **Log step timings** in Settings writes per-phase timings to the service worker console.
