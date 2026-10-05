# Errand public release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the extension publicly as **Errand**: rebranded, with a logo, a first run that works for strangers, docs, a licence, store material and a release pipeline.

**Architecture:** The logo geometry lives in one pure TS module (`src/lib/ui/logo.ts`) used by both the React `Logo` component and a Node build script (Node 24 runs `.ts` natively) that writes the SVG and PNG icons. First run drops profile seeding. A small `profileActions` layer keeps `activeProfileId` valid when profiles are added or removed. Provider presets are a pure data module feeding the existing options-page profile form. Docs and workflows are static files.

**Tech Stack:** WXT 0.21 + React 19 + TypeScript, Vitest, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-05-errand-release-design.md`

## Global Constraints

- Manifest `name` "Errand — AI browser agent"; `short_name` "Errand"; `action.default_title` "Open Errand"; version 1.0.0.
- Tab group title "Errand", colour purple.
- Licence AGPL-3.0-only.
- Logo: bare glyph. Ring gradient `#9579ff` → `#5b3fe0`, cursor `#7c5cff`, cursor tip at ring centre, equal clearance on both sides of the gap, no tile. The 128 icon artwork sits inside the central 96×96.
- No new runtime or dev dependencies.
- Existing installs keep stored profiles; nothing is migrated or deleted.

## Review Focus

- Saving the first profile in Settings must make it the active profile, or Send stays disabled with no explanation (the old default `activeProfileId` was `'macbook'`). → Task 3 test.
- Deleting the active profile must fall back to another profile (or `null`), not leave a dangling id. → Task 3 test.
- An existing install whose `activeProfileId` points at a real profile must keep it when another profile is saved. → Task 3 test.
- The empty state must leave as soon as a profile is saved in another tab (storage change), with no reload. → Task 6 e2e.
- The 16px icon must keep the gap and cursor distinct. → Task 2, visual check of the rendered PNGs.

---

### Task 1: Rename to Errand

**Files:** Modify `wxt.config.ts`, `package.json`, `src/entrypoints/sidepanel/index.html`, `src/entrypoints/options/index.html`, `src/entrypoints/options/App.tsx:18`, `src/lib/browser/tabs.ts:58`, `src/lib/agent/prompts.ts:45`, `tests/unit/browser/tabs.test.ts:61-64`, `tests/e2e/agent.spec.ts:44`

- [ ] Change the test in `tabs.test.ts` to expect `{ title: 'Errand', color: 'purple' }` and say "Errand" in the test name. Run `npx vitest run tests/unit/browser/tabs.test.ts`; expect FAIL.
- [ ] `tabs.ts:58` → `title: 'Errand'`. `prompts.ts:45` → `You control only the tabs in the "Errand" tab group.` Rerun; expect PASS.
- [ ] `wxt.config.ts` manifest:
```ts
name: 'Errand — AI browser agent',
short_name: 'Errand',
description: 'An AI agent that browses for you in a side panel. Bring any OpenAI-compatible model: OpenAI, OpenRouter, Ollama and more.',
action: { default_title: 'Open Errand' },
```
- [ ] `package.json`: `"name": "errand"`, `"version": "1.0.0"`, `"description"` same as above, `"license": "AGPL-3.0-only"`, `"repository": "github:Dread63/errand"`.
- [ ] HTML titles: side panel "Errand", options "Errand settings". Options header text "Errand". Rename the e2e test at `agent.spec.ts:44` to "…join the Errand tab group".
- [ ] `grep -rn "Browser Control\|browser-control" src tests wxt.config.ts package.json` returns nothing. `npm run compile && npm test` passes. Commit "feat: rename to Errand".

### Task 2: Logo and icons

**Files:** Create `src/lib/ui/logo.ts`, `scripts/build-icons.ts`, `src/assets/logo.svg` (generated), `public/icon/{16,32,48,128}.png` (generated), `docs/store/promo-440x280.png` (generated), `tests/unit/ui/logo.test.ts`. Modify `src/lib/ui/icons.tsx` (add `Logo`), `package.json` (script `"icons": "node scripts/build-icons.ts"`).

**Produces:** `logoSvg(opts?: { size?: number; small?: boolean; id?: string }): string`, a complete `<svg>` with a 128 viewBox whose artwork is fitted into the central 96 box. `small` uses a heavier stroke for 16 and 32px. `Logo({ size }: { size: number })`, a React component.

- [ ] Test `logo.test.ts`: `logoSvg()` starts with `<svg`, contains `viewBox="0 0 128 128"`, both gradient colours, and the cursor path. Two calls with different `id`s give different gradient ids. The gap is symmetric: parse the arc's start and end points and check that the angle from the ring centre to each one, minus the cursor edge angle (90° and atan2(37,38)), is equal within 0.01°. Expect FAIL.
- [ ] Implement `logo.ts`:
```ts
const CURSOR = 'M0 0 L0 52 L12.5 40 L21 59 L30 55 L21.5 37 L38 37 Z';
const RIGHT_EDGE = (Math.atan2(37, 38) * 180) / Math.PI;
const LEFT_EDGE = 90;
interface Geometry { r: number; sw: number; s: number; clr: number }
const REGULAR: Geometry = { r: 42, sw: 15, s: 1.08, clr: 6 };
const SMALL: Geometry = { r: 40, sw: 19, s: 1.12, clr: 9 };

/** Ring arc that leaves a gap for the cursor, with equal clearance either side. */
export function ringArc({ r, sw, clr }: Geometry, cx = 0, cy = 0): { d: string; start: [number, number]; end: [number, number] } { ... }
export function logoSvg({ size = 128, small = false, id = 'errand' } = {}): string { ... }
```
  `logoSvg` draws the ring at (0,0). Its bounding box is the union of the ring (±(r+sw/2)) and the cursor (0..38s+1, 0..59s+1). It scales and translates that box to fit centred in [16,112]², and returns the SVG with a `linearGradient id="${id}-g"`.
- [ ] Add `Logo` to `icons.tsx`: `<span className="brand-logo" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: logoSvg({ size, id: useId() }) }} />` (static, self-generated markup).
- [ ] `scripts/build-icons.ts`: imports `logoSvg` from `../src/lib/ui/logo.ts`, writes `src/assets/logo.svg`, and launches `chromium` from `@playwright/test`. For each size in [16,32,48,128] it uses `page.setContent` with the SVG at that size (`small` for 16 and 32) on a transparent background, then `page.locator('svg').screenshot({ omitBackground: true, path })`. The promo tile is a 440×280 HTML page with a `#faf9ff` background, the logo at 120px, "Errand" in 56px system-ui semibold `#18181b`, and "AI browser agent" in 22px `#71717a`, saved to `docs/store/promo-440x280.png`.
- [ ] Run `npm run icons`. Look at each PNG on light and dark backgrounds and tune `SMALL` until the 16px gap and cursor are distinct. Run the tests; expect PASS. `npm run build`, then check the generated manifest has `icons` entries for 16/32/48/128. Commit "feat: Errand logo and icons".

### Task 3: No seeded profiles; keep the active profile valid

**Files:** Modify `src/lib/storage/profiles.ts`, `src/lib/storage/settings.ts:23`, `src/entrypoints/background.ts:18`, `tests/unit/storage.test.ts:32-44`, `src/entrypoints/options/App.tsx` (save and delete handlers).

**Produces:** in `profiles.ts`:
```ts
export async function saveProfile(profiles: ProfileStore, settings: SettingsStore, p: Profile): Promise<void>
export async function removeProfile(profiles: ProfileStore, settings: SettingsStore, id: string): Promise<void>
```

- [ ] Replace the seeding tests in `storage.test.ts` with:
  - saving the first profile when `activeProfileId` is the old default or null makes it active
  - saving another profile when the active one exists keeps the active one
  - removing the active profile falls back to the first remaining one, or null when none remain
  - removing a non-active profile leaves the active one
  
  Expect FAIL.
- [ ] Implement `saveProfile` (save; if `settings.activeProfileId` isn't among the stored ids, set it to `p.id`) and `removeProfile` (remove; if the removed id was active, set the active profile to the first remaining id or `null`). Delete `DEFAULT_PROFILES` and `seedDefaults`. `DEFAULT_SETTINGS.activeProfileId = null`. Remove the seeding line and its import from `background.ts` (keep any other onInstalled work).
- [ ] The options `ProfilesSection` uses `saveProfile` and `removeProfile` with a `SettingsStore(chromeKV())`. Change the base-URL placeholder to `https://api.example.com/v1`.
- [ ] `npm test && npm run compile` pass. Commit "feat: stop seeding personal default profiles".

### Task 4: Provider presets

**Files:** Create `src/lib/ui/presets.ts`, `tests/unit/ui/presets.test.ts`

**Produces:**
```ts
export interface ProviderPreset { id: string; name: string; baseUrl: string; contextMode: ContextMode; contextWindow: number; supportsVision: boolean; reasoningEffort?: ReasoningEffort; hint?: string }
export const PROVIDER_PRESETS: ProviderPreset[]
export function profileFromPreset(preset: ProviderPreset): Profile
```

- [ ] Tests:
  - the ids are exactly `['openai','openrouter','ollama','lmstudio','opencode-go','custom']`
  - every non-custom preset's profile with `model: 'm'` passes `validateProfile`
  - `profileFromPreset` gives unique ids, an empty model, and the preset's name and base URL
  - the Ollama hint contains `OLLAMA_ORIGINS=chrome-extension://*`
  - the LM Studio hint mentions CORS
  
  Expect FAIL.
- [ ] Implement with the values from the spec §3 table. `profileFromPreset` is `{ ...newProfile(), name, baseUrl, contextMode, contextWindow, supportsVision, reasoningEffort }`, with no `reasoningEffort` key when it's undefined. PASS. Commit "feat: provider presets".

### Task 5: Settings — preset picker, hint, empty prompt, branding

**Files:** Modify `src/entrypoints/options/App.tsx`, `src/entrypoints/options/style.css`. Test: `tests/e2e/ui.spec.ts`.

- [ ] e2e test "Add provider offers presets that pre-fill the form":
  1. open `chrome-extension://${extensionId}/options.html` on a fresh install
  2. expect the text "Add your first provider"
  3. click `Add provider`, then the `Ollama (local)` button
  4. expect the Base URL input `toHaveValue('http://localhost:11434/v1')` and the text `OLLAMA_ORIGINS=chrome-extension://*` to be visible
  
  Run `npm run test:e2e -- -g "presets"`; expect FAIL.
- [ ] Header: `<Logo size={28} />` + `<h1>Errand</h1>` + muted "Settings". When `profiles.length === 0`, show the empty prompt above the list: "Add your first provider to start. Errand works with any OpenAI-compatible API." "Add provider" toggles a `.presets` grid of buttons (one per preset, preset name). Clicking one runs `setEditing(profileFromPreset(p))` and stores `editingHint = p.hint`. `ProfileForm` takes an optional `hint` prop, rendered as `<p className="hint">` under the Base URL. Hints use markdown-ish backticks; render the text plain with `<code>` for the backtick spans.
- [ ] CSS: `.presets { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; margin:8px 0 }`, `.hint { font-size:12px; color:var(--muted) }`, `.brand { display:flex; align-items:center; gap:10px }`.
- [ ] e2e PASS. Commit "feat: provider preset picker in settings".

### Task 6: Side panel — Connect a model; new logo in the empty state

**Files:** Modify `src/entrypoints/sidepanel/components/ChatView.tsx`, `src/entrypoints/sidepanel/App.tsx`, `src/entrypoints/sidepanel/style.css`, `tests/e2e/fixtures.ts:50-53`, `tests/e2e/ui.spec.ts`

- [ ] Remove the seeding poll from `configure()` in `fixtures.ts`.
- [ ] e2e test "fresh install asks to connect a model":
  1. open the panel with no `configure()` call
  2. expect "Connect a model to get started", and `composer-send` disabled after filling the input
  3. click `Open Settings` and expect a page whose URL matches `/options\.html/`
  4. then call `configure(sw, …)` and expect the panel to show "What should I do in this tab?" without a reload
  
  Expect FAIL.
- [ ] `ChatView` gets a `connected: boolean` prop (App passes `profiles.length > 0`). Empty state when not connected: `<Logo size={44}/>`, `<h2>Connect a model to get started</h2>`, `<p>Errand works with any OpenAI-compatible API: OpenAI, OpenRouter, Ollama, LM Studio and more.</p>`, `<button className="btn primary" onClick={() => chrome.runtime.openOptionsPage()}>Open Settings</button>`. The connected empty state replaces the old purple-tile cursor with `<Logo size={44}/>`; its text is unchanged. Remove the now-unused `.empty .logo` tile styles.
- [ ] `npm run test:e2e` passes in full. Commit "feat: connect-a-model empty state".

### Task 7: Licence, privacy, README, listing, changelog

**Files:** Create `LICENSE`, `PRIVACY.md`, `CHANGELOG.md`, `docs/store/listing.md`. Rewrite `README.md`.

- [ ] `LICENSE`: download the verbatim AGPL-3.0 text from `https://www.gnu.org/licenses/agpl-3.0.txt`. Check it starts with "GNU AFFERO GENERAL PUBLIC LICENSE" / "Version 3, 19 November 2007".
- [ ] `PRIVACY.md`, `docs/store/listing.md` and `CHANGELOG.md` with the content from spec §4–5. Check the listing's permission list against `wxt.config.ts` exactly.
- [ ] `README.md` sections in spec §5 order. Image: `docs/store/screenshot-1-task.png`. Logo: `src/assets/logo.svg`.
- [ ] Commit "docs: licence, privacy policy, README and store listing".

### Task 8: Store screenshots

**Files:** Create `scripts/store-assets.spec.ts`, `playwright.store.config.ts`. Modify `package.json` (script `"store-assets": "wxt build && playwright test -c playwright.store.config.ts"`). Outputs `docs/store/screenshot-{1-task,2-approval,3-models,4-settings}.png`.

- [ ] A Playwright "test" file that reuses `tests/e2e/fixtures.ts` and `servers`. For each shot: script the mock LLM, open `form.html` (or `shop-a.html`) in an 860×800 window, open the panel at 420×800, and drive it to the state. Take a page screenshot and a panel screenshot, then compose them with `page.setContent` (a 1280×800 flex row: page left, 1px border, panel right) and screenshot the result to `docs/store/…`. Shots:
  1. mid-task: script `click` with a long `wait`, so the cursor and highlight are on the page and the activity card is visible
  2. approval gate: script a click on a "Buy" button (risky keyword)
  3. model menu open
  4. options page with the preset grid open, full 1280×800
- [ ] Run `npm run store-assets` and look at each PNG. Commit "chore: store screenshots".

### Task 9: CI and release workflows

**Files:** Create `.github/workflows/ci.yml`, `.github/workflows/release.yml`. README "Releasing" section (Task 7) matches.

- [ ] `ci.yml`: on `pull_request` and `push` to main. ubuntu-latest, `actions/setup-node@v4` node 22 with npm cache, `npm ci`, `npm run compile`, `npm test`.
- [ ] `release.yml`: on `push: tags: ['v*']`, `permissions: contents: write`. Same setup and checks, then:
```yaml
- name: Tag matches package.json version
  run: test "v$(node -p "require('./package.json').version")" = "$GITHUB_REF_NAME"
- run: npm run zip
- run: gh release create "$GITHUB_REF_NAME" .output/*-chrome.zip --title "Errand $GITHUB_REF_NAME" --generate-notes
  env: { GH_TOKEN: '${{ github.token }}' }
```
- [ ] Locally: `npm run zip`, then check `.output/errand-1.0.0-chrome.zip` exists and unzips to a manifest with name "Errand — AI browser agent". Commit "ci: test workflow and tag release workflow".

### Final verification

- [ ] `npm run compile && npm test && npm run test:e2e` all pass. `grep -rni "browser control\|macbook" src` returns nothing.
