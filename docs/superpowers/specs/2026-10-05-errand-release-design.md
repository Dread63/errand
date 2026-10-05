# Errand public release — design

Date: 2026-10-05
Status: approved in brainstorming, awaiting spec review

## Goal

Turn the personal "Browser Control" extension into **Errand**, a public, installable Chromium extension: rebranded, with a logo, a first-run experience that works for strangers, a proper README, a privacy policy, a licence, store-listing material, and a release pipeline that produces an installable zip. Then the user submits it to the Chrome Web Store.

Audience: the general public, installing from the Chrome Web Store (Chrome, Brave, Opera, Vivaldi, Arc) or from a GitHub release zip. Users bring their own OpenAI-compatible model endpoint; there is no Errand backend.

Behaviour that stays as it is: the agent loop, tools, site approvals, risky-action approvals, Stop, History, attachments, theme, and model menu.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Name | **Errand**. Manifest `name` "Errand — AI browser agent", `short_name` "Errand". ("Open Browser Control" was dropped: an MIT extension with that exact name and purpose is already on the Web Store.) |
| Audience | General public |
| Logo | **Bare glyph**: thick purple-gradient open ring, cursor tip at the ring's centre, cursor body leaving through the gap with equal clearance on both sides, no background tile. Mockup: `.superpowers/brainstorm/*/content/ring-v3.html` option 4. |
| First run | No seeded profiles; "Connect a model" empty state; provider presets in Settings |
| Tab group | Renamed "Agent" → **"Errand"**, still purple |
| Licence | **AGPL-3.0-only** |
| Repo | Renamed `Dread63/browser-control` → `Dread63/errand` (user does it in GitHub settings, or via `gh repo rename`) |
| Distribution | Chrome Web Store (manual upload) + zip attached to each GitHub release by a tag-triggered Action. No auto-publish to the store, no Edge Add-ons listing, no Firefox (no `debugger` API). |
| Website | None for v1. `PRIVACY.md` in the repo is the privacy-policy URL; the repo is the homepage. |
| Version | 1.0.0 |

## 1. Rename

- `wxt.config.ts` manifest: `name: 'Errand — AI browser agent'`, `short_name: 'Errand'`, `description` = the store short description (≤132 chars, see §5), `action.default_title: 'Open Errand'`. Permissions unchanged.
- `package.json`: `name: "errand"`, `version: "1.0.0"`, `description` matching the manifest, `license: "AGPL-3.0-only"`, `repository` → `github:Dread63/errand`. WXT reads the manifest version from `package.json`.
- UI strings: side panel `<title>` "Errand"; options `<title>` "Errand settings"; options header text (`src/entrypoints/options/App.tsx:18`) "Errand". Any other user-visible "Browser Control" in `src/` (`grep -rn "Browser Control" src`) becomes "Errand".
- Tab group: `src/lib/browser/tabs.ts` creates the group with `{ title: 'Errand', color: 'purple' }`. System prompt (`src/lib/agent/prompts.ts`) says the agent controls only the tabs in the "Errand" tab group. Unit test `tests/unit/browser/tabs.test.ts` and e2e test names that mention the "Agent" group are updated.

## 2. Logo

- `scripts/build-icons.mjs` (Node, uses the existing `@playwright/test` Chromium to rasterise; no new dependency):
  - Builds the mark from geometry, as in the brainstorm generator: cursor path `M0 0 L0 52 L12.5 40 L21 59 L30 55 L21.5 37 L38 37 Z` with its tip at the ring centre; the gap's two ends are placed at the cursor's edge angles (≈44.2° and 90°) plus `(strokeWidth/2 + clearance)/r` so both sides clear equally.
  - Ring stroke: linear gradient `#9579ff` → `#5b3fe0`; cursor fill `#7c5cff`.
  - Writes `assets/logo.svg` (128 viewBox, the master) and `public/icon/16.png`, `32.png`, `48.png`, `128.png`. WXT auto-adds `public/icon/*.png` to the manifest `icons` and `action.default_icon`.
  - The 128 icon keeps the artwork inside the central 96×96 (Chrome icon guideline: 16px transparent padding). The 16 and 32 sizes are rendered from a variant with a thicker stroke and larger clearance so the gap and cursor stay distinct; final values are tuned by eye from rendered output.
  - Also writes `assets/promo-440x280.png` (see §6).
- Generated files are committed; `npm run icons` reruns the script. The build doesn't depend on it.
- In-app: a `Logo` component in `src/lib/ui/icons.tsx` renders the same SVG inline; it is used in the side-panel empty states and the settings header.

## 3. First run

### No seeding
- Delete `DEFAULT_PROFILES` and `ProfileStore.seedDefaults()` (`src/lib/storage/profiles.ts`), and the `seedDefaults()` call in `src/entrypoints/background.ts`. Existing installs keep their stored profiles; nothing is migrated or removed.

### Side panel: no model configured
- When `profiles.length === 0`, the chat area shows a **Connect a model** card instead of the normal empty state: the logo, the heading "Connect a model to get started", the line "Errand works with any OpenAI-compatible API: OpenAI, OpenRouter, Ollama, LM Studio and more.", and an **Open Settings** button (`chrome.runtime.openOptionsPage()`).
- The composer stays visible but Send is disabled (the existing `ready` flag is false with no active profile). Profiles saved from Settings appear live via the existing `chrome.storage.onChanged` path in `useProfiles`.

### Settings: provider presets
- New module `src/lib/ui/presets.ts` exporting `PROVIDER_PRESETS: ProviderPreset[]` and `profileFromPreset(preset): Profile` (fresh UUID, `model: ''`, other fields from the preset over `newProfile()` defaults).

| id | name | baseUrl | contextMode | contextWindow | supportsVision | reasoningEffort | hint |
|---|---|---|---|---|---|---|---|
| openai | OpenAI | `https://api.openai.com/v1` | full | 128000 | true | — | — |
| openrouter | OpenRouter | `https://openrouter.ai/api/v1` | full | 128000 | false | — | Turn on images per model if it supports them. |
| ollama | Ollama (local) | `http://localhost:11434/v1` | compact | 32768 | false | — | Start Ollama with `OLLAMA_ORIGINS=chrome-extension://*`, or it rejects requests from the extension. |
| lmstudio | LM Studio (local) | `http://localhost:1234/v1` | compact | 32768 | false | — | Enable CORS in LM Studio's server settings. |
| opencode-go | OpenCode Go | `https://opencode.ai/zen/go/v1` | full | 1000000 | false | low | — |
| custom | Custom | `http://` | standard | 32768 | false | — | Any OpenAI-compatible `/v1` endpoint. |

- **Add provider** opens a small preset picker (a grid of buttons, one per preset). Choosing one opens the existing profile editor pre-filled from `profileFromPreset`, with the preset's hint shown under the Base URL field. From there the flow is unchanged: key → Test connection → pick model → Save. Cancel discards it.
- When there are no profiles, the settings page shows a short "Add your first provider" prompt above the list.

## 4. Licence and privacy

- `LICENSE`: verbatim AGPL-3.0 text from gnu.org.
- `PRIVACY.md` states:
  - Errand has no servers, accounts, analytics or telemetry, and the developer receives no data.
  - Settings, API keys, site permissions and chat history are stored locally with `chrome.storage.local` on the user's device. Screenshots are not saved to history.
  - While a task runs, the page text, element snapshots, screenshots, the user's messages and attachments are sent **only to the model endpoint the user configured**, and that provider's privacy policy applies. Local endpoints (Ollama, LM Studio) keep the data on the user's machine.
  - Nothing is sold, transferred for advertising, or used for creditworthiness or lending.
  - Uninstalling removes all stored data. Contact: GitHub issues on the repo.
- The data-use answers in `docs/store/listing.md` match it exactly.

## 5. README and listing docs

- `README.md`, rewritten:
  - logo, one-line pitch, store badge placeholder (filled in after approval)
  - screenshot
  - features
  - install: from the store, or from a release zip (download → unzip → `chrome://extensions` → Developer mode → Load unpacked)
  - quick start with per-provider setup (OpenAI, OpenRouter, Ollama, LM Studio, OpenCode Go, and "remote self-hosted": the current MacBook/MTPLX/Tailscale notes, generalised)
  - how it works and safety: the tab group, approvals, the debugger bar, Stop
  - privacy summary linking `PRIVACY.md`
  - develop/test commands (current section)
  - releasing
  - licence
- `docs/store/listing.md`, the source for everything pasted into the Web Store dashboard:
  - **Short description** (≤132 chars), e.g. "An AI agent that browses for you in a side panel. Bring any OpenAI-compatible model: OpenAI, OpenRouter, Ollama and more."
  - **Long description**: what it does, features, bring-your-own-model, safety model, privacy, open source (AGPL) link.
  - **Category**: Productivity (Tools as the alternative). Language: English.
  - **Single purpose**: "Errand performs web tasks the user asks for, in the user's browser, using a language model the user configures."
  - **Permission justifications**, one paragraph each: `debugger` (trusted mouse/keyboard input and screenshots via the Chrome DevTools Protocol, only on tabs in the Errand group while a task runs; Chrome shows its debugging bar), host `<all_urls>` and the content script (read page structure and highlight elements on whatever site the user's task needs; new sites need explicit user approval in the panel), `scripting` (re-inject the page agent into tabs opened mid-task), `tabs` and `tabGroups` (open, find and group the tabs the agent works in), `sidePanel`, `storage`, `unlimitedStorage` (local chat history with attachments).
  - **Remote code**: "No, I am not using remote code." All JS is bundled; model responses are data, not code.
  - **Data usage** checkboxes and certifications matching `PRIVACY.md`: website content and user activity are handled to provide the feature, and sent only to the user-chosen endpoint.
  - **Reviewer test instructions**: how to point it at a provider. The user supplies a test API key (e.g. a capped OpenRouter key) in the dashboard's private test-instructions field; never commit it.
- `CHANGELOG.md`: "1.0.0: first public release" plus a summary of the features.

## 6. Store images

- `scripts/store-assets.ts`, run with `npm run store-assets`, which builds first. It reuses the e2e harness: `tests/e2e/fixtures.ts` for launching the built extension, and `startServers()` for the test pages and scripted mock LLM.
- Outputs to `docs/store/` (committed):
  - `screenshot-1-task.png`: a task mid-run on `form.html` with the cursor, highlight and activity card visible
  - `screenshot-2-approval.png`: a risky-action approval card
  - `screenshot-3-models.png`: the model menu open
  - `screenshot-4-settings.png`: the provider preset picker
- Each screenshot is 1280×800: the page and side panel are captured, then composed side by side on a neutral background by an HTML page that Playwright screenshots, because the side panel can't be screenshotted together with the tab directly.
- `assets/promo-440x280.png` (small promo tile, required): logo plus "Errand" wordmark plus "AI browser agent", from `build-icons.mjs`.
- README uses `screenshot-1-task.png`. The user may replace any of these with real-use captures later.

## 7. CI and release

- `.github/workflows/ci.yml`, on pull requests and pushes to main, Node 22: `npm ci`, `npm run compile`, `npm test`. No e2e for now; that would need headed Chromium under xvfb.
- `.github/workflows/release.yml`, on `push` of tags `v*`: the same checks, then a step that fails unless `v$(node -p "require('./package.json').version")` equals the tag, then `npm run zip`, then `gh release create "$TAG" .output/*-chrome.zip --generate-notes` (`permissions: contents: write`).
- Release flow, documented in the README: bump the version in `package.json`, update `CHANGELOG.md`, commit, `git tag vX.Y.Z && git push --tags`, then upload the zip from the release to the dashboard.

## 8. Testing

- Unit:
  - `presets.ts`: every preset produces a profile that passes `validateProfile` once a model is set; `profileFromPreset` gives unique ids; hints are present for Ollama and LM Studio.
  - `profiles.ts`: no `seedDefaults` export.
  - `tabs.test.ts`: the group title is "Errand".
- e2e fixture: `tests/e2e/fixtures.ts` already writes its own mock-LLM profile, but first polls for `onInstalled` seeding (`fixtures.ts:50`). That poll is removed, since nothing is seeded any more. The fresh-install test below uses a variant that writes no profile.
- e2e (`tests/e2e/ui.spec.ts`):
  - Fresh install shows "Connect a model to get started", Send is disabled, and Open Settings opens the options page.
  - Settings → Add provider → Ollama pre-fills the base URL and shows the `OLLAMA_ORIGINS` hint.
  - After a profile is saved, the side panel leaves the empty state without a reload.
- Manual: load `.output/chrome-mv3` unpacked, check the icons at all sizes in light and dark toolbars and in `chrome://extensions`, and confirm the release zip loads unpacked.

## 9. User checklist (things only Josh can do)

1. Rename the repo to `Dread63/errand` and update the local remote (`git remote set-url origin git@github-personal:Dread63/errand.git`).
2. Register a Chrome Web Store developer account (one-time US$5) and verify the contact email.
3. Push tag `v1.0.0` and download the zip from the GitHub release.
4. In the dashboard: upload the zip, then paste the listing, permission justifications, privacy-policy URL (`https://github.com/Dread63/errand/blob/main/PRIVACY.md`), data-use answers and test instructions with a capped test key. Upload the screenshots and promo tile.
5. Submit for review. Expect an in-depth review because of `debugger` + `<all_urls>`, which may take several weeks. Afterwards, add the store link to the README badge.

## Out of scope

Edge Add-ons listing, automated Web Store publishing, a website or GitHub Pages, translations, Firefox, e2e in CI, and changes to agent behaviour.
