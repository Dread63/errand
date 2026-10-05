# UI facelift — design

Date: 2026-10-05
Status: approved in brainstorming, awaiting spec review

## Goal

Make the side panel and settings page look and feel clean and modern (closer to ChatGPT / Linear), make the on-page cursor soft and animated, show the agent's work (thinking, actions, screenshots) in a tidy grouped form, render assistant markdown properly, and let the user pick any model from any provider directly in the composer.

Behaviour that stays as it is: site permission prompts, risky-action approvals, `ask` questions, retry gates, Stop, History, drag-drop/paste attachments, and the background agent loop.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Visual direction | **Crisp with purple accent**: white / zinc neutrals, accent `#7c5cff` (matches the Agent tab group and on-page border). |
| Theme | Light and dark. New setting **System / Light / Dark**, default System. Applies to side panel and settings page. |
| Cursor | **Rounded arrow + action label pill** that follows it. |
| Activity display | **Grouped activity card** per task. |
| Model picking | **Model menu in the composer**, all providers' models grouped by provider. |
| Markdown | Assistant replies render as GitHub-flavoured markdown, including while streaming. |
| Empty state | Clean: icon, one heading, one line of copy. **No starter prompts.** |

Mockups from the session live in `.superpowers/brainstorm/` (git-ignored): `visual-direction.html` (option B), `cursor-v3.html` (option B), `activity.html` (option A), `composer.html`.

## 1. Visual system

- One hand-written token stylesheet shared by side panel and options page: `src/lib/ui/theme.css`. Tokens on `:root` (colours, radii, spacing, shadows, font stack), dark values under `:root[data-theme="dark"]` and under `@media (prefers-color-scheme: dark)` for `:root[data-theme="system"]`.
- No CSS framework. Each entrypoint keeps its own `style.css` for layout, importing `theme.css`.
- Icons: a small inline SVG line-icon module, `src/lib/ui/icons.tsx` (new chat, history, settings, paperclip, send, stop, chevron, check, spinner, warning, globe, file, image, copy, refresh, sparkle). No icon dependency.
- Theme application: `useTheme()` hook (`src/lib/ui/useTheme.ts`) reads `settings.theme` and sets `document.documentElement.dataset.theme`; re-applies on `chrome.storage.onChanged`.
- Key palette (light / dark): bg `#ffffff` / `#111114`; surface `#fafafb` / `#18181d`; border `#ececf1` / `#2a2a31`; fg `#18181b` / `#ececf1`; muted `#71717a` / `#9a9aa8`; accent `#7c5cff` both; accent-soft `#efeaff` / `#2a2346`; warn surface `#fffbeb` / `#2a2210`; danger `#dc2626` / `#f87171`.

## 2. Side panel

### Layout (top to bottom)

1. **Header** — chat title (first user message, truncated; "New chat" when empty) and three icon buttons: New chat, History, Settings. Buttons keep `aria-label`s `New chat`, `History`, `Settings`.
2. **Chat** — scrollable. Auto-scrolls to bottom only when the user is already near the bottom.
3. **Gates** — approval / site / ask / retry cards, restyled (amber card for risky, accent card for site and ask, red for retry). Button names unchanged: `Allow once`, `Always allow`, `Deny`, `Approve`, `Reject`, `Send answer`, `Retry`, `Stop`.
4. **Error banner** — dismissible, restyled.
5. **Tab chip** — "Working in: <tab title>" with favicon, above the composer.
6. **Composer** — rounded card: attachment tray, auto-growing textarea, bottom bar with paperclip button, model pill, and round send / stop button. Test ids `composer-input`, `composer-send`, `composer-stop` kept.

### Messages

- **User**: right-aligned accent bubble; attachments shown above the text as small thumbnails / file chips.
- **Assistant**: no bubble, full width, rendered by `Markdown`.
- **Empty state**: centred logo mark, "What should I do in this tab?", "I'll ask before using a new site or doing anything risky." Nothing else.

### Activity card

- `groupTurns(turns)` (pure, in `src/lib/ui/activity.ts`) folds consecutive `step` turns between a user turn and the next assistant/user turn into one `ActivityGroup { steps, startedAt?, endedAt? }`.
- While running, the trailing group is open and its header shows a shimmering "Working · step N" and elapsed time; the live row at the bottom shows streamed thinking (shimmer "Thinking…" with a 2-line preview) or "Working…".
- When finished, the group collapses to "Worked through N steps · 24s" (duration omitted when timestamps are missing). Click to expand.
- Each step row: status icon (check / failed / approval badge), label (single line, ellipsis), screenshot thumbnail if present. Click to expand: full screenshot, result in a mono block, and the step's reasoning.
- Thinking with a step shows as its own row above it: "Thought for 4s" + 2-line italic preview, click to expand. When `thinkingMs` is missing, it shows "Thought".
- Failed steps (result starts with `Error` or `The user rejected`) get a red icon and the group header shows a small failure count.

### Data additions

- `StepTurn` gains optional `startedAt?: number`, `endedAt?: number`, `thinkingMs?: number`, set by the agent loop. Optional so existing history loads unchanged.

### Markdown

- Dependencies: `react-markdown` + `remark-gfm`.
- Component `src/entrypoints/sidepanel/components/Markdown.tsx`. Raw HTML is not rendered (react-markdown default, no `rehype-raw`). Links get `target="_blank" rel="noopener noreferrer"`; only `http`, `https` and `mailto` URLs are kept as links. Code blocks get a copy button. Tables scroll horizontally inside the message.
- Streaming text is rendered through the same component.

### Attachments

- Paperclip opens the file picker; drag-drop over the whole panel shows a full-panel drop zone; paste still works.
- Tray: images as 52px thumbnails, other files as cards with type badge, name and a meta line (page count for PDFs, size otherwise). Each has a remove button `aria-label="Remove <name>"`.
- `Attachment` gains optional `meta?: string`. `readAttachment` fills it (PDF page count — `pdfToText` changes to return `{ text, pages }` — else formatted size).
- Image attachments are rejected with an inline error when the selected model is not vision-capable (same rule as today, now per model — see §3).

## 3. Model picking

- Selection = active profile + that profile's `model`. Choosing a model in the menu saves `profile.model = id` and `settings.activeProfileId = profile.id`. The background `start` path is unchanged.
- `ModelCatalog` (`src/lib/storage/models.ts`): caches `{ [profileId]: { models: string[]; fetchedAt: number; error?: string } }` in `chrome.storage.local`. `refresh(profile)` calls `listModels`; on failure keeps the previous list and records `error`.
- Menu opens instantly from cache and refreshes every profile in the background (at most once per 5 minutes per profile, or on the per-group refresh button).
- Menu: search box (filters by model id, case-insensitive), groups by profile name, check on the active model, `vision` tag on vision models, warning line for profiles whose refresh failed ("Couldn't reach <name> — showing last known models"), footer "Manage providers…" opening the options page. The profile's current `model` is always listed even if the catalog doesn't contain it. Keyboard: arrow keys, Enter, Escape. Disabled while running.
- Vision per model: `Profile` gains optional `visionModels?: string[]`. `supportsVisionFor(profile, model)`: if `visionModels` is non-empty, true iff it contains `model`; otherwise `profile.supportsVision`. Used by the composer check. In the background, `session.ts` resolves an effective profile once at task start — `{ ...profile, supportsVision: supportsVisionFor(profile, profile.model) }` — and passes that to its image check and to the agent loop, so `loop.ts` / `context.ts` keep reading `supportsVision` unchanged.
- Pill label: the model id, shortened for display (e.g. `glm-5.3-flash` → `GLM 5.3 Flash`) via a small `prettyModel()` helper; full id in the tooltip.

## 4. Settings (options) page

- Same tokens and theme. Sections become cards: **Providers** (was Model profiles), **Sites**, **General**.
- Provider form: same fields; model chosen from the fetched list (with free-text fallback); new multi-select "Vision-capable models" from the fetched list.
- General gains **Theme: System / Light / Dark**. `Settings` gains `theme: 'system' | 'light' | 'dark'` (default `'system'`).

## 5. On-page cursor (`src/lib/content/overlay.ts`)

- Arrow: rounded-corner path, accent fill, white 1.8px outline, drop shadow; gentle glow animation while idle.
- Motion: cursor element moves with a slight arc — implemented with the Web Animations API through a mid-point offset perpendicular to travel (≤ 12% of distance, max 60px), eased `cubic-bezier(.45,0,.2,1)`; duration scales with distance (180–450ms) instead of a fixed 300ms. `moveTo` still resolves when the motion ends.
- Click: arrow scales to 0.82 and back (~140ms) plus a soft filled pulse replacing the outlined ripple.
- Label pill: accent pill, white 600 11.5px text, positioned bottom-right of the arrow; flips to the left when it would overflow the viewport's right edge, and above when near the bottom. Text is set by `moveTo(x, y, label?)` and kept until the next label or `setActive(false)`. Truncated to 40 chars.
- Protocol: `{ type: 'overlay'; op: 'move'; x; y; label?: string }`. The driver passes `describeCall(call, target)` when moving for an action; keyboard focus-follow moves pass no label (keeps the current one).
- Page border: same colour, softer inner glow.
- Respects `prefers-reduced-motion`: no arc, no idle glow, 120ms moves.

## 6. Component map

```
sidepanel/App.tsx               layout + view switching
components/Header.tsx           title + icon buttons
components/ChatView.tsx         messages, activity groups, empty state, smart autoscroll
components/ActivityCard.tsx     group header, StepRow, ThinkingRow, live row
components/Markdown.tsx         react-markdown + gfm, safe links, code copy
components/GateCard.tsx         restyled, same API
components/Composer.tsx         textarea, send/stop, drop zone
components/AttachmentTray.tsx   thumbnails / file cards
components/ModelMenu.tsx        pill + popover menu
components/TabChip.tsx          "Working in" chip
components/HistoryList.tsx      restyled list, relative times
lib/ui/activity.ts              groupTurns (pure)
lib/ui/models.ts                prettyModel, supportsVisionFor, filter helpers (pure)
lib/ui/useModelCatalog.ts       hook over ModelCatalog
lib/ui/useTheme.ts              theme hook
lib/ui/icons.tsx                inline SVG icons
lib/ui/theme.css                tokens
lib/storage/models.ts           ModelCatalog
```

`ProfilePicker.tsx` and `StepCard.tsx` are replaced by `ModelMenu` and `ActivityCard`.

## 7. Error handling

- Model list fetch failures never block sending; they show in the menu only.
- A profile with an empty `model` shows "Choose a model" on the pill and Send is disabled with a tooltip.
- Markdown rendering errors are not expected; unknown nodes render as text.
- Missing timing fields hide durations rather than showing 0s.

## 8. Testing

Unit (Vitest):
- `groupTurns`: grouping boundaries, running vs finished, failures count, missing timestamps.
- `ModelCatalog`: cache hit, refresh success, refresh failure keeps last list + error, 5-minute throttle.
- `supportsVisionFor`, `prettyModel`, model search filter.
- Selecting a model writes `profile.model` and `activeProfileId`.
- `session.ts` image check uses per-model vision.
- Markdown: tables, links get safe attributes, `javascript:` links dropped, raw `<script>`/`<img onerror>` stays text.
- Overlay: label text set/kept/cleared, label flips near right/bottom edges, reduced-motion path, `moveTo` resolves.
- `readAttachment` fills `meta`; `pdfToText` returns page count.
- Agent loop sets `startedAt`/`endedAt`/`thinkingMs`.

E2E (Playwright): all existing specs pass unchanged; new checks that a markdown reply renders a list/table element, that a model can be chosen from the menu and is used for the next task, and that the activity card collapses after the task with the step count.

Visual check: screenshots of the real side panel and options page in light and dark at panel width (~380px), and the cursor + label on a test page.

## Out of scope

Starter prompts, per-conversation model memory, switching models mid-task, new attachment types, changes to agent behaviour or prompts.
