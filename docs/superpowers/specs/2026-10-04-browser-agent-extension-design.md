# Browser Agent Extension — Design

Date: 2026-10-04
Status: Approved design, pending implementation plan

## 1. Goal

A Chrome (Manifest V3) extension that gives an interactive, Claude-in-Chrome–style browsing agent backed by **user-chosen OpenAI-compatible models**: local Qwen models served by MTPLX on a MacBook (reached over Tailscale) or hosted models via an OpenCode Go API key.

The user opens a side panel chat, describes a task (optionally attaching files/images), and watches the agent operate their real browser with a visible animated cursor, hover/click feedback, and element highlights.

### Success criteria

- Works on any machine running Chrome; models are selected via named provider profiles.
- Agent can complete multi-step tasks (navigate, click, type, select, scroll, multi-tab) using trusted input events.
- User sees what the agent is doing in real time (cursor, highlights, step log).
- Agent cannot act on a site without permission, and cannot perform risky actions without per-action approval.
- Quality scales with model capability: compact for small local models, rich context for large-context hosted models.

### Non-goals (v1)

- Cross-device sync of history or settings.
- Firefox/Safari support.
- Synthetic-event fallback when the debugger cannot attach (possible later addition).
- Recording/replaying workflows, scheduled tasks.

## 2. Key decisions

| Topic | Decision |
|---|---|
| Model access | Named provider profiles, each `{name, baseUrl, apiKey, model, supportsVision, contextMode, contextWindow, maxScreenshots}`; OpenAI `/v1/chat/completions` protocol |
| Vision | Per-profile toggle; screenshots and image attachments only sent when enabled |
| Page control | Hybrid: content script for snapshot/overlay, `chrome.debugger` (CDP) for trusted input and screenshots |
| Autonomy | Per-site permission (allow once / always / deny) **plus** per-action approval for risky actions on every site |
| Tab scope | Agent operates only within its own dedicated, colored tab group |
| History | Local conversation history in extension storage (screenshots stripped), per device |
| Context depth | Per-profile context mode: Compact / Standard / Full |
| Stack | WXT + TypeScript + React (side panel, options), Vitest, Playwright |

## 3. Architecture

```
┌──────────────┐  port msgs   ┌────────────────────────────┐   OpenAI API   ┌───────────────┐
│  Side panel  │◄────────────►│  Background service worker │◄──────────────►│ MTPLX (Tail-  │
│  (React UI)  │              │                            │                │ scale) / OCGo │
└──────────────┘              │  agent/loop.ts             │                └───────────────┘
                              │  llm/client.ts             │
┌──────────────┐              │  browser/cdp.ts ───────────┼──► chrome.debugger (input, screenshots)
│ Options page │              │  browser/tabs.ts           │
│ (profiles,   │              │  policy/permissions.ts     │
│  sites)      │              │  storage/*.ts              │
└──────────────┘              └─────────────┬──────────────┘
                                            │ tabs.sendMessage
                                   ┌────────▼─────────┐
                                   │  Content script  │  snapshot.ts (element list + IDs)
                                   │  (all frames)    │  overlay.ts  (cursor, highlights,
                                   └──────────────────┘              "agent active" border)
```

### 3.1 Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `llm/client.ts` | `chat/completions` with streaming + `tools`; parses native tool calls, falls back to extracting a JSON tool call from text content | Profile config |
| `agent/loop.ts` | Step loop: snapshot (+ screenshot if vision) → build context → model → policy check → execute tool → repeat. Terminates on `done`, Stop, step limit (default 30, configurable), or unrecoverable error | `LlmClient`, `BrowserDriver`, `Policy` interfaces (injectable for tests) |
| `agent/context.ts` | Builds the message array per context mode and token budget | Profile config, history |
| `agent/tools.ts` | Tool schemas and dispatch | `BrowserDriver` |
| `browser/cdp.ts` | Debugger attach/detach, `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`/`insertText`, `Page.captureScreenshot` | `chrome.debugger` |
| `browser/tabs.ts` | Create/manage agent tab group; open/switch/close only within group; track new tabs opened from group tabs | `chrome.tabs`, `chrome.tabGroups` |
| `content/snapshot.ts` | Enumerates visible interactive/labeled elements, assigns stable-per-snapshot IDs, returns role, name, value, state, bounding box; page text extraction | DOM |
| `content/overlay.ts` | Shadow-DOM overlay: animated cursor, hover ring, click ripple, target highlight, glowing page border while active | DOM |
| `policy/permissions.ts` | Site allowlist checks; risky-action classification | Storage |
| `storage/*.ts` | Profiles, site permissions, settings, conversation history (`chrome.storage.local`; IndexedDB if history grows large) | `chrome.storage` |
| Side panel UI | Chat, attachments, streaming replies, step cards, approval cards, Stop, history list, profile picker | Background via `runtime.connect` port |
| Options page | Profile CRUD (with "test connection"), site permission list with revoke, risky-keyword list, step limit | Storage |

### 3.2 Tool set

`click(id)`, `type(id, text, submit?)`, `select(id, value)`, `scroll(direction | id)`, `hover(id)`, `key(combo)`, `navigate(url)`, `back()`, `wait(ms)`, `read_text()`, `new_tab(url)`, `switch_tab(index)`, `close_tab(index)`, `ask_user(question)`, `done(summary)`.

Every action tool accepts an optional `risky: boolean` and `reason: string` from the model.

### 3.3 Action execution (example: `click(12)`)

1. Background asks the content script for element 12's current center coordinates (scrolls into view if needed). Missing/stale ID → error back to model with fresh snapshot.
2. Policy check (site permission, risky classification). If approval needed, pause and show approval card with element highlighted.
3. Overlay animates cursor to target (~300 ms), shows hover ring.
4. CDP dispatches `mouseMoved` → `mousePressed` → `mouseReleased`; overlay shows click ripple.
5. Wait for network-idle / DOM settle (bounded), then next snapshot.

The cursor always moves **before** the real event fires.

## 4. Data flow

1. User submits a prompt with attachments:
   - Images → `image_url` parts (rejected with an explanation if active profile lacks vision).
   - Text/code/PDF → extracted text, capped per context mode.
2. Background creates (or reuses) the agent tab group seeded with the current tab, and attaches the debugger.
3. Loop per step: snapshot (+ screenshot) → `context.ts` builds messages → model streams to side panel → tool call → policy → execute.
4. Each step renders as a compact card in the side panel (action label, expandable reasoning, screenshot thumbnail if any).
5. On completion, conversation (minus screenshots) is saved to history.

## 5. Context modes

Configured per profile, together with `contextWindow` (tokens). Default for new profiles: Standard. Suggested presets: MacBook/Qwen → Compact; OpenCode/GLM → Full.

| Aspect | Compact | Standard | Full |
|---|---|---|---|
| Prior page snapshots | 1-line summaries | Last 2 full, older summarized | Full, within budget |
| Element list per snapshot | ~4k tokens, interactive only | ~10k tokens | ~20k+ tokens, plus headings/landmarks/nearby text |
| `read_text()` output | ~3k tokens | ~12k tokens | ~50k tokens |
| Screenshots sent | Latest only | Latest only | Last N (`maxScreenshots`, default 3) |
| System prompt | Short, explicit, one worked tool-call example | Moderate | Detailed strategy, recovery, multi-tab guidance |
| Attachment text cap | ~20k chars each | ~60k chars each | Fitted to context window |

In every mode a token estimator (chars/4 heuristic, corrected by API `usage` when provided) enforces `contextWindow` minus a reply reserve, trimming oldest material first.

## 6. Permissions and safety

### 6.1 Site permissions

- Keyed by origin (scheme + host).
- First action **or read** on a non-permitted origin pauses with: **Allow once** (this task), **Always allow**, **Deny**. Deny is reported to the model as a tool error.
- Options page lists always-allowed origins with revoke.

### 6.2 Risky actions (require per-action approval on every site)

Rule-based classification, any match:
- Typing into password, credit card, CVC, or one-time-code fields (`type`, `autocomplete`, `name`/`id` heuristics).
- Clicking a submit control, or a control whose accessible name matches the risky keyword list (default: buy, pay, purchase, order, checkout, confirm, delete, remove, send, post, publish, transfer, subscribe; user-editable).
- Pressing Enter inside a form; actions that trigger file download or upload.
- Model sets `risky: true`. The model cannot override a rule-based match.

Approval card shows highlighted target, exact action, and model's reason. Approvals are single-use; no "approve all".

### 6.3 Prompt injection

- Page content is wrapped as clearly delimited untrusted data; system prompt instructs the model to ignore instructions inside page content.
- The enforced backstop is code-level: site permissions and risky-action approvals apply regardless of model output.
- Stop button is always visible during a task and detaches the debugger immediately.

## 7. Error handling

| Failure | Behavior |
|---|---|
| LLM network/timeout/4xx/5xx | 2 retries with exponential backoff; then error in chat with Retry, task state preserved |
| Malformed tool call | Error returned to model; 2 correction attempts; then pause and show raw output |
| Stale/missing element ID | Fresh snapshot sent with "element not found" error |
| Debugger detached (DevTools opened, restricted page like `chrome://` or Web Store) | Pause with explanation; resumes when reattach succeeds |
| Navigation mid-action | Wait for load, re-inject content script, re-snapshot |
| Step limit reached / Stop | End cleanly with summary of completed steps |

## 8. Testing

- **Unit (Vitest):** LLM client (streaming, native tool calls, JSON-in-text fallback); policy (site permissions, risky classification); context builder across all three modes and budget trimming; agent loop with scripted fake LLM and fake `BrowserDriver`.
- **E2E (Playwright, unpacked extension):** local fixture pages (form, shop with checkout, page that opens new tabs) and a mock OpenAI server returning scripted tool calls; assert real clicks land, approval cards appear, overlay renders, tab group behavior.
- **Manual smoke:** one real task via MTPLX over Tailscale; one via OpenCode Go.

## 9. Deployment notes

- Loaded as an unpacked extension (or packed `.crx`) on each machine; no Web Store publishing required.
- MTPLX must listen on the Tailscale interface, not only `127.0.0.1`.
- Host permissions: `<all_urls>` (needed for content scripts and calling arbitrary profile base URLs).
