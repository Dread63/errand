# UI Facelift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the side panel and settings page (crisp white/zinc with purple accent, light + dark), replace the on-page cursor with a rounded animated arrow + action label, group the agent's work into collapsible activity cards, render assistant markdown, and add a ChatGPT-style model menu with polished attachments.

**Architecture:** Pure logic (turn grouping, model helpers, model catalog cache, overlay label placement) lives in `src/lib/**` and is unit-tested in Vitest. React components in `src/entrypoints/sidepanel/components/` stay thin and are verified by the Playwright e2e suite plus screenshots. The background start path is unchanged except for resolving per-model vision once in `session.ts`. The agent loop gains step timing and saved thinking.

**Tech Stack:** WXT 0.21 (Chrome MV3), React 19, TypeScript 5.9, Vitest 5 (node + happy-dom), Playwright 1.63, new deps `react-markdown@^10.1.0` and `remark-gfm@^4.0.1`.

**Spec:** `docs/superpowers/specs/2026-10-05-ui-facelift-design.md`

## Global Constraints

- Accent colour `#7c5cff` in both themes; light/dark tokens exactly as listed in spec §1.
- Theme setting values: `'system' | 'light' | 'dark'`, default `'system'`, applied via `document.documentElement.dataset.theme`.
- No CSS framework, no icon dependency. Only new runtime deps: `react-markdown`, `remark-gfm`. Never add `rehype-raw`.
- Markdown links: only `http:`, `https:`, `mailto:` stay links; all get `target="_blank" rel="noopener noreferrer"`.
- Empty state: icon, "What should I do in this tab?", "I'll ask before using a new site or doing anything risky." — **no starter prompts**.
- Keep these accessible names / test ids exactly: `composer-input`, `composer-send`, `composer-stop`, `thinking` (test id on the live row), buttons `Allow once`, `Always allow`, `Deny`, `Approve`, `Reject`, `Send answer`, `Retry`, `Stop`, `Remove <name>`, header buttons `New chat`, `History`, `Settings`.
- New fields on persisted types are **optional** so existing saved history and profiles load unchanged.
- Cursor label truncated to 40 chars; arc offset ≤ 12% of travel distance, max 60px; move duration 180–450ms by distance; reduced motion → no arc, no glow, 120ms.
- Model catalog refresh throttle: 5 minutes per profile.
- Saved thinking per step truncated to 4000 chars.
- Run commands from the repo root `/home/josh/dev/browser-control`.

## Review Focus

1. **A finished task's step labels must still be findable.** The activity card collapses when a task ends; anyone (and `sheet.spec.ts`) wanting a step detail must be able to expand it with one click on the header. Task 9 updates `sheet.spec.ts` to click the header and adds a unit test that `groupTurns` marks only the trailing group of a running task as live.
2. **Model ids that are not in the fetched list** (typed by hand, or the endpoint is down) must still appear in the menu and be selected. Task 4 tests `menuGroups` always includes the profile's current `model`.
3. **Assistant text containing raw HTML or `javascript:` links** (the model reads untrusted pages) must render inert. Task 7 tests `<script>`, `<img onerror>` and `[x](javascript:alert(1))`.
4. **A profile with an empty model id** must not start a task. Task 4 tests `canSend` false for empty model; Task 8 disables Send.
5. **The cursor label near the right or bottom edge** must stay on screen. Task 6 tests `labelPlacement` flips at both edges.

---

## File Structure

```
src/lib/types.ts                          + StepTurn timing/thinking, Attachment.meta, Profile.visionModels, Settings.theme
src/lib/storage/settings.ts               + theme default
src/lib/ui/models.ts            (new)     prettyModel, supportsVisionFor, filterModels, menuGroups, canSend
src/lib/storage/models.ts       (new)     ModelCatalog cache + selectModel
src/lib/ui/useModelCatalog.ts   (new)     React hook over ModelCatalog
src/lib/ui/activity.ts          (new)     groupTurns, formatDuration
src/lib/agent/loop.ts                     record startedAt/endedAt/thinking/thinkingMs
src/lib/background/session.ts             effective per-model vision
src/lib/attachments.ts                    meta (pages / size)
src/lib/pdf.ts                            return { text, pages }
src/lib/content/overlay.ts                rounded arrow, arc motion, press, pulse, label pill
src/lib/content/protocol.ts               move.label
src/lib/content/agent.ts                  pass label
src/lib/browser/driver.ts                 send step label with moves
src/lib/ui/theme.css            (new)     tokens, light/dark
src/lib/ui/useTheme.ts          (new)     apply theme
src/lib/ui/icons.tsx            (new)     inline SVG icons
src/entrypoints/sidepanel/components/Markdown.tsx      (new)
src/entrypoints/sidepanel/components/ActivityCard.tsx  (new, replaces StepCard.tsx)
src/entrypoints/sidepanel/components/Header.tsx        (new)
src/entrypoints/sidepanel/components/ChatView.tsx      rewritten
src/entrypoints/sidepanel/components/GateCard.tsx      restyled
src/entrypoints/sidepanel/components/AttachmentTray.tsx (new)
src/entrypoints/sidepanel/components/ModelMenu.tsx     (new, replaces ProfilePicker.tsx)
src/entrypoints/sidepanel/components/TabChip.tsx       (new)
src/entrypoints/sidepanel/components/Composer.tsx      rewritten
src/entrypoints/sidepanel/components/HistoryList.tsx   restyled
src/entrypoints/sidepanel/App.tsx                      new layout
src/entrypoints/sidepanel/style.css                    rewritten
src/entrypoints/sidepanel/main.tsx                     import theme.css
src/entrypoints/options/*                              refreshed + theme + vision models
tests/unit/ui/models.test.ts, tests/unit/storage/models.test.ts, tests/unit/ui/activity.test.ts,
tests/unit/ui/markdown.test.tsx (new); overlay/loop/session/attachments tests extended
tests/e2e/ui.spec.ts (new); tests/e2e/sheet.spec.ts (one-line change)
```

---

### Task 1: Type additions and model helpers

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/storage/settings.ts:22-27`
- Create: `src/lib/ui/models.ts`
- Test: `tests/unit/ui/models.test.ts`

**Interfaces:**
- Produces:
  - `type Theme = 'system' | 'light' | 'dark'`; `Settings.theme: Theme`
  - `Profile.visionModels?: string[]`
  - `Attachment.meta?: string`
  - `StepTurn` (the `'step'` variant of `Turn`) gains `startedAt?: number; endedAt?: number; thinking?: string; thinkingMs?: number`
  - `prettyModel(id: string): string`
  - `supportsVisionFor(p: Pick<Profile,'supportsVision'|'visionModels'>, model: string): boolean`
  - `filterModels(ids: string[], query: string): string[]`
  - `interface MenuGroup { profileId: string; name: string; models: string[]; error?: string }`
  - `menuGroups(profiles: Profile[], catalog: Record<string, CatalogEntry | undefined>, query: string): MenuGroup[]`
  - `interface CatalogEntry { models: string[]; fetchedAt: number; error?: string }` (exported from `models.ts`, reused by Task 4)
  - `canSend(p: Profile | null): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/models.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canSend, filterModels, menuGroups, prettyModel, supportsVisionFor } from '@/lib/ui/models';
import type { Profile } from '@/lib/types';

const prof = (over: Partial<Profile> = {}): Profile => ({
  id: 'p', name: 'P', baseUrl: 'http://x/v1', apiKey: '', model: 'glm-5.3-flash',
  supportsVision: false, contextMode: 'standard', contextWindow: 1000, maxScreenshots: 1, ...over,
});

describe('prettyModel', () => {
  it('title-cases words and keeps version numbers', () => {
    expect(prettyModel('glm-5.3-flash')).toBe('GLM 5.3 Flash');
    expect(prettyModel('qwen3.6-35b-a3b')).toBe('Qwen3.6 35B A3B');
    expect(prettyModel('org/kimi-k3')).toBe('Kimi K3');
    expect(prettyModel('')).toBe('Choose a model');
  });
});

describe('supportsVisionFor', () => {
  it('uses the profile flag when no per-model list is set', () => {
    expect(supportsVisionFor(prof({ supportsVision: true }), 'x')).toBe(true);
    expect(supportsVisionFor(prof(), 'x')).toBe(false);
  });
  it('uses the per-model list when it is non-empty', () => {
    const p = prof({ supportsVision: true, visionModels: ['kimi-k3'] });
    expect(supportsVisionFor(p, 'kimi-k3')).toBe(true);
    expect(supportsVisionFor(p, 'glm-5.3')).toBe(false);
    expect(supportsVisionFor(prof({ visionModels: [] , supportsVision: true}), 'a')).toBe(true);
  });
});

describe('filterModels', () => {
  it('matches case-insensitively on any substring', () => {
    expect(filterModels(['GLM-5.3', 'kimi-k3', 'glm-5.3-flash'], 'glm')).toEqual(['GLM-5.3', 'glm-5.3-flash']);
    expect(filterModels(['a', 'b'], '  ')).toEqual(['a', 'b']);
  });
});

describe('menuGroups', () => {
  it('groups by profile, keeps the current model even if not fetched, and carries errors', () => {
    const a = prof({ id: 'a', name: 'A', model: 'typed-by-hand' });
    const b = prof({ id: 'b', name: 'B', model: 'm2' });
    const groups = menuGroups([a, b], { a: { models: ['m1'], fetchedAt: 1, error: 'down' } }, '');
    expect(groups).toEqual([
      { profileId: 'a', name: 'A', models: ['typed-by-hand', 'm1'], error: 'down' },
      { profileId: 'b', name: 'B', models: ['m2'] },
    ]);
  });
  it('drops groups with no match when searching', () => {
    const a = prof({ id: 'a', name: 'A', model: 'x1' });
    const b = prof({ id: 'b', name: 'B', model: 'y1' });
    expect(menuGroups([a, b], {}, 'y').map((g) => g.profileId)).toEqual(['b']);
  });
  it('does not list an empty current model', () => {
    expect(menuGroups([prof({ model: '' })], { p: { models: ['m'], fetchedAt: 1 } }, '')[0].models).toEqual(['m']);
  });
});

describe('canSend', () => {
  it('needs a profile with a model id', () => {
    expect(canSend(null)).toBe(false);
    expect(canSend(prof({ model: '  ' }))).toBe(false);
    expect(canSend(prof())).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ui/models.test.ts`
Expected: FAIL — cannot resolve `@/lib/ui/models`.

- [ ] **Step 3: Add the type fields**

In `src/lib/types.ts`:

```ts
export type Theme = 'system' | 'light' | 'dark';
```

Add to `Profile` (after `reasoningEffort`):

```ts
  /** Model ids that accept images. When non-empty it overrides supportsVision per model. */
  visionModels?: string[];
```

Add to `Settings`:

```ts
  theme: Theme;
```

Add to `Attachment`:

```ts
  /** Short description for the attachment card, e.g. "4 pages" or "12 KB". */
  meta?: string;
```

Replace the `'step'` variant of `Turn` with:

```ts
  | {
      kind: 'step';
      id: string;
      label: string;
      reasoning: string;
      call: ToolCall;
      result: string;
      risky: boolean;
      observation?: ObservationRecord;
      /** Epoch ms when the step's model request started and when the step finished. */
      startedAt?: number;
      endedAt?: number;
      /** The model's streamed thinking for this step (truncated), and how long it thought. */
      thinking?: string;
      thinkingMs?: number;
    }
```

In `src/lib/storage/settings.ts`, add `theme: 'system',` to `DEFAULT_SETTINGS`.

In `tests/e2e/fixtures.ts` `configure()`, add `theme: 'system'` to the `settings` object so the type stays complete (it is untyped there, but keep it consistent).

- [ ] **Step 4: Write `src/lib/ui/models.ts`**

```ts
import type { Profile } from '../types';

export interface CatalogEntry {
  models: string[];
  fetchedAt: number;
  error?: string;
}

export interface MenuGroup {
  profileId: string;
  name: string;
  models: string[];
  error?: string;
}

const UPPER = new Set(['glm', 'gpt', 'llm', 'vl', 'moe']);

/** "glm-5.3-flash" → "GLM 5.3 Flash"; drops an "org/" prefix. */
export function prettyModel(id: string): string {
  const base = id.split('/').pop()!.trim();
  if (!base) return 'Choose a model';
  return base
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => {
      if (UPPER.has(w.toLowerCase())) return w.toUpperCase();
      if (/^\d+(\.\d+)?[a-z]$/i.test(w) || /^[a-z]\d+[a-z]?$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

export function supportsVisionFor(p: Pick<Profile, 'supportsVision' | 'visionModels'>, model: string): boolean {
  return p.visionModels && p.visionModels.length > 0 ? p.visionModels.includes(model) : p.supportsVision;
}

export function filterModels(ids: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  return q ? ids.filter((id) => id.toLowerCase().includes(q)) : ids;
}

export function menuGroups(profiles: Profile[], catalog: Record<string, CatalogEntry | undefined>, query: string): MenuGroup[] {
  const out: MenuGroup[] = [];
  for (const p of profiles) {
    const entry = catalog[p.id];
    const current = p.model.trim();
    const all = [...(current ? [current] : []), ...(entry?.models ?? []).filter((m) => m !== current)];
    const models = filterModels(all, query);
    if (query.trim() && models.length === 0) continue;
    out.push({ profileId: p.id, name: p.name, models, ...(entry?.error ? { error: entry.error } : {}) });
  }
  return out;
}

export function canSend(p: Profile | null): boolean {
  return !!p && p.model.trim().length > 0;
}
```

Check `prettyModel('qwen3.6-35b-a3b')`: words `qwen3.6` → `Qwen3.6`; `35b` matches `^\d+(\.\d+)?[a-z]$` → `35B`; `a3b` matches `^[a-z]\d+[a-z]?$` → `A3B`. `kimi-k3`: `k3` → `K3`. `5.3` → unchanged via capitalise (digit). `flash` → `Flash`.

- [ ] **Step 5: Run tests and type-check**

Run: `npx vitest run tests/unit/ui/models.test.ts && npm run compile`
Expected: PASS; `tsc` reports no errors. If `tsc` flags places constructing a full `Settings` literal (e.g. tests), add `theme: 'system'` there.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/storage/settings.ts src/lib/ui/models.ts tests/unit/ui/models.test.ts tests/e2e/fixtures.ts
git commit -m "feat: add theme setting, per-model vision and model menu helpers"
```

---

### Task 2: Step timing and saved thinking in the agent loop; per-model vision in the session

**Files:**
- Modify: `src/lib/agent/loop.ts` (`callModel`, step construction in `runAgent`)
- Modify: `src/lib/background/session.ts:137-150,173-177`
- Modify: `tests/unit/agent/fakes.ts` (`FakeLlm`)
- Test: `tests/unit/agent/loop.test.ts`, `tests/unit/background/session.test.ts`

**Interfaces:**
- Consumes: `StepTurn` timing fields and `supportsVisionFor` (Task 1).
- Produces: every `StepTurn` pushed by `runAgent` has `startedAt` and `endedAt`; `thinking`/`thinkingMs` when the model streamed reasoning. `AgentDeps.now?: () => number` (defaults to `Date.now`) for deterministic tests.

- [ ] **Step 1: Let `FakeLlm` stream thinking**

In `tests/unit/agent/fakes.ts`, change `FakeLlm` so a script item may carry `thinking`:

```ts
export type FakeReply = ChatResult & { thinking?: string };

export class FakeLlm implements LlmClient {
  requests: ChatRequest[] = [];
  constructor(public script: Array<FakeReply | Error>) {}
  async chat(req: ChatRequest): Promise<ChatResult> {
    this.requests.push(req);
    const next = this.script.shift();
    if (!next) throw new Error('FakeLlm script exhausted');
    if (next instanceof Error) throw next;
    if (next.thinking) for (const ch of next.thinking.match(/.{1,5}/gs) ?? []) req.onReasoning?.(ch);
    const { thinking: _t, ...result } = next;
    return result;
  }
}
```

- [ ] **Step 2: Write the failing loop tests**

Append inside `describe('runAgent', …)` in `tests/unit/agent/loop.test.ts`:

```ts
  it('records step timing and the thinking streamed for that step', async () => {
    const s = setup([{ ...toolCall('click', { id: 1 }), thinking: 'I should click the button.' }, toolCall('done', { summary: 'ok' })]);
    let t = 1000;
    s.deps.now = () => (t += 100);
    const turns = await runAgent(task, s.deps);
    const [click, done] = steps(turns);
    expect(click.thinking).toBe('I should click the button.');
    expect(click.thinkingMs).toBeGreaterThan(0);
    expect(click.startedAt).toBeLessThan(click.endedAt!);
    expect(done.thinking).toBeUndefined();
    expect(done.startedAt).toBeGreaterThanOrEqual(click.endedAt!);
  });

  it('truncates very long thinking', async () => {
    const s = setup([{ ...toolCall('done', { summary: 'ok' }), thinking: 'x'.repeat(5000) }]);
    const [done] = steps(await runAgent(task, s.deps));
    expect(done.thinking!.length).toBeLessThanOrEqual(4001);
    expect(done.thinking!.startsWith('…')).toBe(true);
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/unit/agent/loop.test.ts`
Expected: FAIL — `click.thinking` is undefined; `s.deps.now` is not a known property (TS error is fine at runtime in Vitest; assertion fails).

- [ ] **Step 4: Implement in `src/lib/agent/loop.ts`**

Add to `AgentDeps`:

```ts
  /** Clock for step timestamps; defaults to Date.now. */
  now?: () => number;
```

Add near the top (after `NUDGE`):

```ts
const MAX_THINKING = 4000;

interface ModelReply {
  result: ChatResult;
  thinking: string;
  thinkingMs: number;
}
```

Replace `callModel` with:

```ts
async function callModel(d: AgentDeps, messages: ChatMessage[], now: () => number): Promise<ModelReply> {
  for (;;) {
    let thinking = '';
    let firstAt = 0;
    let lastAt = 0;
    try {
      const result = await d.llm.chat({
        messages,
        tools: toolSchemas(d.profile.supportsVision),
        signal: d.signal,
        onDelta: (t) => d.hooks.onDelta(t),
        onReasoning: (t) => {
          const at = now();
          if (!thinking) firstAt = at;
          lastAt = at;
          thinking += t;
          d.hooks.onReasoning?.(t);
        },
        ...(d.sessionId ? { sessionId: d.sessionId } : {}),
      });
      const trimmed = thinking.trim();
      return {
        result,
        thinking: trimmed.length > MAX_THINKING ? `…${trimmed.slice(-MAX_THINKING)}` : trimmed,
        thinkingMs: trimmed ? Math.max(1, lastAt - firstAt) : 0,
      };
    } catch (e) {
      if (d.signal.aborted) throw e;
      const msg = errMsg(e);
      if (!(await d.gate.retry(`Model request failed: ${msg}`))) throw new StopTask(`Stopped: the model request failed (${msg}).`);
    }
  }
}
```

In `runAgent`:

1. After `const newId = …` add `const now = d.now ?? Date.now;`.
2. Change `const push = (t: Turn) => {` to stamp steps:

```ts
  const push = (t: Turn) => {
    if (t.kind === 'step' && t.endedAt === undefined) t.endedAt = now();
    turns.push(t);
    d.hooks.onTurns([...turns]);
  };
```

3. At the top of the `for` body, after `const stepStart = performance.now();`, add `const startedAt = now();`.
4. Replace `const result = await timed(…, () => callModel(d, messages));` with:

```ts
      const reply = await timed(`step ${n + 1}: model (total, ~${estimateTokens(messages)} prompt tokens est.)`, () => callModel(d, messages, now));
      const result = reply.result;
```

5. In the `step` literal add:

```ts
        startedAt,
        ...(reply.thinking ? { thinking: reply.thinking, thinkingMs: reply.thinkingMs } : {}),
```

- [ ] **Step 5: Run loop tests**

Run: `npx vitest run tests/unit/agent/loop.test.ts`
Expected: PASS (all existing tests too — `toMatchObject` ignores the new fields; if an existing test uses `toEqual` on a whole step, add `startedAt: expect.any(Number), endedAt: expect.any(Number)`).

- [ ] **Step 6: Write the failing session test**

Append to `describe('PanelSession', …)` in `tests/unit/background/session.test.ts`:

```ts
  it('resolves vision per model: a vision model on a non-vision profile gets coordinates and images', async () => {
    const s = await setup([toolCall('done', { summary: 'ok' })], { allow: true, profile: { visionModels: ['m'] } });
    await s.session.handle({ ...start, attachments: [{ name: 'a.png', kind: 'image', dataUrl: 'data:image/png;base64,AA==' }] });
    expect(s.posted.find((m) => m.type === 'error')).toBeUndefined();
    const click = (s.llm.requests[0].tools as Array<{ function: { name: string; parameters: { properties: object } } }>).find((t) => t.function.name === 'click')!;
    expect(click.function.parameters.properties).toHaveProperty('x');
  });

  it('rejects images when the selected model is not in the vision list', async () => {
    const s = await setup([], { allow: true, vision: true, profile: { visionModels: ['other'] } });
    await s.session.handle({ ...start, attachments: [{ name: 'a.png', kind: 'image', dataUrl: 'data:image/png;base64,AA==' }] });
    expect(s.posted[0]).toMatchObject({ type: 'error', message: expect.stringMatching(/does not support images/) });
  });
```

First extend that file's `setup()` so a test can override profile fields: change its signature to
`async function setup(script: ChatResult[], opts: { allow?: boolean; vision?: boolean; noProfile?: boolean; profile?: Partial<Profile> } = {})`,
change the save line to `if (!opts.noProfile) await profiles.save({ ...testProfile, supportsVision: !!opts.vision, ...opts.profile });`,
and add `import type { Profile } from '@/lib/types';`.

- [ ] **Step 7: Run to verify they fail**

Run: `npx vitest run tests/unit/background/session.test.ts`
Expected: the first new test FAILS (image rejected / no `x`); the second FAILS (task runs).

- [ ] **Step 8: Implement in `src/lib/background/session.ts`**

Add import: `import { supportsVisionFor } from '../ui/models';`

Replace the block from `const profile = settings.activeProfileId ? …` through the image check with:

```ts
    const stored = settings.activeProfileId ? await this.deps.profiles.get(settings.activeProfileId) : undefined;
    if (!stored) {
      this.post({ type: 'error', message: 'No model selected. Choose one in the model menu or add a provider in Settings.' });
      return;
    }
    // Vision is resolved once for the chosen model, so the agent loop keeps reading supportsVision.
    const profile: Profile = { ...stored, supportsVision: supportsVisionFor(stored, stored.model) };
    if (!profile.supportsVision && msg.attachments.some((a) => a.kind === 'image')) {
      this.post({
        type: 'error',
        message: `The model "${profile.model}" does not support images. Remove image attachments or mark it as vision-capable in Settings.`,
      });
      return;
    }
```

Check `tests/unit/background/session.test.ts` for an assertion on the old "No model profile selected" text; update its regex to `/No model selected/` if present.

- [ ] **Step 9: Run all unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/agent/loop.ts src/lib/background/session.ts tests/unit/agent/fakes.ts tests/unit/agent/loop.test.ts tests/unit/background/session.test.ts
git commit -m "feat: record step timing and thinking; resolve vision per model"
```

---

### Task 3: Attachment meta and PDF page count

**Files:**
- Modify: `src/lib/pdf.ts`
- Modify: `src/lib/attachments.ts`
- Test: `tests/unit/attachments.test.ts`

**Interfaces:**
- Produces: `pdfToText(file: File): Promise<{ text: string; pages: number }>`; `AttachmentDeps.pdfToText?: (file: File) => Promise<{ text: string; pages: number }>`; `formatBytes(n: number): string` exported from `attachments.ts`; every `readAttachment` result has `meta`.

- [ ] **Step 1: Update the tests (failing)**

In `tests/unit/attachments.test.ts`:
- Change import to `import { formatBytes, MAX_IMAGE_BYTES, readAttachment } from '@/lib/attachments';`
- Replace the first three `it` blocks with:

```ts
  it('reads images as data URLs with their size', async () => {
    const a = await readAttachment(new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }));
    expect(a).toEqual({ name: 'shot.png', kind: 'image', dataUrl: 'data:image/png;base64,AQID', meta: '3 B' });
  });

  it('reads text and code files by type or extension', async () => {
    expect(await readAttachment(new File(['hello'], 'notes.txt', { type: 'text/plain' }))).toEqual({ name: 'notes.txt', kind: 'text', text: 'hello', meta: '5 B' });
    expect((await readAttachment(new File(['x = 1'], 'a.py', { type: '' }))).text).toBe('x = 1');
    expect((await readAttachment(new File(['{}'], 'a.json', { type: 'application/json' }))).kind).toBe('text');
  });

  it('routes PDFs to the PDF extractor and reports pages', async () => {
    const pdfToText = vi.fn(async () => ({ text: '--- Page 1 ---\nHi', pages: 1 }));
    const a = await readAttachment(new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }), { pdfToText });
    expect(a).toEqual({ name: 'doc.pdf', kind: 'text', text: '--- Page 1 ---\nHi', meta: '1 page' });
    const b = await readAttachment(new File(['%PDF'], 'b.pdf', { type: 'application/pdf' }), { pdfToText: async () => ({ text: '', pages: 4 }) });
    expect(b.meta).toBe('4 pages');
  });

  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(12 * 1024)).toBe('12 KB');
    expect(formatBytes(3.2 * 1024 * 1024)).toBe('3.2 MB');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/attachments.test.ts`
Expected: FAIL — `formatBytes` not exported, `meta` missing.

- [ ] **Step 3: Implement**

`src/lib/pdf.ts` — change the function to:

```ts
export async function pdfToText(file: File): Promise<{ text: string; pages: number }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  return { text: pages.map((p, i) => `--- Page ${i + 1} ---\n${p}`).join('\n\n'), pages: doc.numPages };
}
```

`src/lib/attachments.ts`:

```ts
export interface AttachmentDeps {
  pdfToText?: (file: File) => Promise<{ text: string; pages: number }>;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = v >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1);
  return `${s} ${units[i]}`;
}
```

and in `readAttachment` add `meta` to each return:

```ts
    return { name: file.name, kind: 'image', dataUrl: await toDataUrl(file), meta: formatBytes(file.size) };
```

```ts
    const { text, pages } = await pdfToText(file);
    return { name: file.name, kind: 'text', text, meta: `${pages} page${pages === 1 ? '' : 's'}` };
```

```ts
    return { name: file.name, kind: 'text', text: await file.text(), meta: formatBytes(file.size) };
```

- [ ] **Step 4: Run tests + compile**

Run: `npx vitest run tests/unit/attachments.test.ts && npm run compile`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf.ts src/lib/attachments.ts tests/unit/attachments.test.ts
git commit -m "feat: describe attachments with page count or size"
```

---

### Task 4: Model catalog cache and model selection

**Files:**
- Create: `src/lib/storage/models.ts`
- Create: `src/lib/ui/useModelCatalog.ts`
- Test: `tests/unit/storage/models.test.ts` (create folder `tests/unit/storage/`)

**Interfaces:**
- Consumes: `CatalogEntry` from `src/lib/ui/models.ts`; `listModels(p, fetchImpl?)` from `src/lib/llm/client.ts`; `KV`, `ProfileStore`, `SettingsStore`.
- Produces:
  - `class ModelCatalog { constructor(kv: KV, list?: (p: Profile) => Promise<string[]>, now?: () => number); all(): Promise<Record<string, CatalogEntry>>; refresh(p: Profile, opts?: { force?: boolean }): Promise<CatalogEntry> }` — storage key `modelCatalog`; `REFRESH_MS = 5 * 60_000`.
  - `selectModel(profiles: ProfileStore, settings: SettingsStore, profileId: string, model: string): Promise<void>`
  - `useModelCatalog(profiles: Profile[]): { catalog: Record<string, CatalogEntry>; refreshAll(force?: boolean): void; refreshOne(p: Profile, force: boolean): Promise<void>; refreshing: Set<string> }`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/storage/models.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { memoryKV } from '@/lib/storage/kv';
import { ModelCatalog, REFRESH_MS, selectModel } from '@/lib/storage/models';
import { ProfileStore } from '@/lib/storage/profiles';
import { SettingsStore } from '@/lib/storage/settings';
import { testProfile } from '../agent/fakes';

describe('ModelCatalog', () => {
  it('fetches, caches, and throttles refreshes', async () => {
    let calls = 0;
    let t = 0;
    const cat = new ModelCatalog(memoryKV(), async () => (calls++, ['a', 'b']), () => t);
    expect(await cat.refresh(testProfile)).toEqual({ models: ['a', 'b'], fetchedAt: 0 });
    t = REFRESH_MS - 1;
    await cat.refresh(testProfile);
    expect(calls).toBe(1);
    await cat.refresh(testProfile, { force: true });
    expect(calls).toBe(2);
    t = 2 * REFRESH_MS;
    await cat.refresh(testProfile);
    expect(calls).toBe(3);
    expect((await cat.all())[testProfile.id].models).toEqual(['a', 'b']);
  });

  it('keeps the last known models and records the error when a refresh fails', async () => {
    let fail = false;
    let t = 0;
    const cat = new ModelCatalog(memoryKV(), async () => {
      if (fail) throw new Error('Could not reach http://x/v1/models: offline');
      return ['a'];
    }, () => t);
    await cat.refresh(testProfile);
    fail = true;
    t = REFRESH_MS;
    const e = await cat.refresh(testProfile);
    expect(e.models).toEqual(['a']);
    expect(e.error).toMatch(/offline/);
    fail = false;
    t = 3 * REFRESH_MS;
    expect((await cat.refresh(testProfile)).error).toBeUndefined();
  });

  it('retries a failed provider without waiting for the throttle', async () => {
    let calls = 0;
    const cat = new ModelCatalog(memoryKV(), async () => {
      calls++;
      throw new Error('down');
    }, () => 0);
    await cat.refresh(testProfile);
    await cat.refresh(testProfile);
    expect(calls).toBe(2);
  });
});

describe('selectModel', () => {
  it("sets the profile's model and makes it active", async () => {
    const kv = memoryKV();
    const profiles = new ProfileStore(kv);
    const settings = new SettingsStore(kv);
    await profiles.save(testProfile);
    await profiles.save({ ...testProfile, id: 'q', name: 'Q' });
    await selectModel(profiles, settings, 'q', 'kimi-k3');
    expect((await profiles.get('q'))!.model).toBe('kimi-k3');
    expect((await profiles.get('p'))!.model).toBe('m');
    expect((await settings.get()).activeProfileId).toBe('q');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/storage/models.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/storage/models.ts`**

```ts
import { listModels } from '../llm/client';
import type { Profile } from '../types';
import type { CatalogEntry } from '../ui/models';
import { errMsg } from '../util';
import type { KV } from './kv';
import type { ProfileStore } from './profiles';
import type { SettingsStore } from './settings';

const KEY = 'modelCatalog';
export const REFRESH_MS = 5 * 60_000;

/** Last known model ids per profile, so the model menu opens instantly. */
export class ModelCatalog {
  constructor(
    private kv: KV,
    private list: (p: Profile) => Promise<string[]> = (p) => listModels(p),
    private now: () => number = Date.now,
  ) {}

  async all(): Promise<Record<string, CatalogEntry>> {
    return (await this.kv.get<Record<string, CatalogEntry>>(KEY)) ?? {};
  }

  async refresh(p: Profile, opts: { force?: boolean } = {}): Promise<CatalogEntry> {
    const all = await this.all();
    const prev = all[p.id];
    if (!opts.force && prev && !prev.error && this.now() - prev.fetchedAt < REFRESH_MS) return prev;
    let next: CatalogEntry;
    try {
      next = { models: await this.list(p), fetchedAt: this.now() };
    } catch (e) {
      next = { models: prev?.models ?? [], fetchedAt: prev?.fetchedAt ?? 0, error: errMsg(e) };
    }
    await this.kv.set(KEY, { ...(await this.all()), [p.id]: next });
    return next;
  }
}

export async function selectModel(profiles: ProfileStore, settings: SettingsStore, profileId: string, model: string): Promise<void> {
  const p = await profiles.get(profileId);
  if (!p) return;
  if (p.model !== model) await profiles.save({ ...p, model });
  await settings.update({ activeProfileId: profileId });
}
```

- [ ] **Step 4: Implement `src/lib/ui/useModelCatalog.ts`**

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { chromeKV } from '../storage/kv';
import { ModelCatalog } from '../storage/models';
import type { Profile } from '../types';
import type { CatalogEntry } from './models';

export function useModelCatalog(profiles: Profile[]) {
  const store = useMemo(() => new ModelCatalog(chromeKV()), []);
  const [catalog, setCatalog] = useState<Record<string, CatalogEntry>>({});
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());

  useEffect(() => {
    void store.all().then(setCatalog);
  }, [store]);

  const refreshOne = useCallback(
    async (p: Profile, force: boolean) => {
      setRefreshing((s) => new Set(s).add(p.id));
      const entry = await store.refresh(p, { force });
      setCatalog((c) => ({ ...c, [p.id]: entry }));
      setRefreshing((s) => {
        const n = new Set(s);
        n.delete(p.id);
        return n;
      });
    },
    [store],
  );

  const refreshAll = useCallback(
    (force = false) => {
      for (const p of profiles) void refreshOne(p, force);
    },
    [profiles, refreshOne],
  );

  return { catalog, refreshAll, refreshOne, refreshing };
}
```

- [ ] **Step 5: Run tests + compile**

Run: `npx vitest run tests/unit/storage/models.test.ts && npm run compile`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage/models.ts src/lib/ui/useModelCatalog.ts tests/unit/storage/models.test.ts
git commit -m "feat: cache each provider's model list and select models from it"
```

---

### Task 5: Group turns into activity cards

**Files:**
- Create: `src/lib/ui/activity.ts`
- Test: `tests/unit/ui/activity.test.ts`

**Interfaces:**
- Consumes: `Turn`, `StepTurn`.
- Produces:
  - `type ChatItem = { kind: 'user'; turn: Extract<Turn,{kind:'user'}>; key: string } | { kind: 'assistant'; text: string; key: string } | { kind: 'activity'; group: ActivityGroup; key: string }`
  - `interface ActivityGroup { steps: StepTurn[]; live: boolean; failures: number; durationMs?: number }`
  - `groupTurns(turns: Turn[], running: boolean): ChatItem[]` — a live (running) trailing group is created even with zero steps when the last item is a user turn and `running` is true.
  - `isFailed(step: StepTurn): boolean`
  - `formatDuration(ms: number): string` — `"4s"`, `"1m 05s"`, `"<1s"`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/activity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatDuration, groupTurns, isFailed } from '@/lib/ui/activity';
import type { StepTurn, Turn } from '@/lib/types';

const step = (id: string, over: Partial<StepTurn> = {}): StepTurn => ({
  kind: 'step', id, label: `Step ${id}`, reasoning: '', call: { id, name: 'click', args: {} }, result: 'ok', risky: false, ...over,
});
const user = (text: string): Turn => ({ kind: 'user', text, attachments: [] });
const reply = (text: string): Turn => ({ kind: 'assistant', text });

describe('groupTurns', () => {
  it('folds consecutive steps between messages into one group', () => {
    const items = groupTurns([user('a'), step('1'), step('2'), reply('done'), user('b'), step('3'), reply('ok')], false);
    expect(items.map((i) => i.kind)).toEqual(['user', 'activity', 'assistant', 'user', 'activity', 'assistant']);
    const g = items[1];
    expect(g.kind === 'activity' && g.group.steps.map((s) => s.id)).toEqual(['1', '2']);
    expect(g.kind === 'activity' && g.group.live).toBe(false);
  });

  it('marks only the trailing group live while running, even before the first step', () => {
    expect(groupTurns([user('a')], true).map((i) => i.kind)).toEqual(['user', 'activity']);
    const items = groupTurns([user('a'), step('1'), reply('r'), user('b'), step('2')], true);
    const groups = items.filter((i) => i.kind === 'activity');
    expect(groups.map((g) => g.kind === 'activity' && g.group.live)).toEqual([false, true]);
    expect(groupTurns([user('a'), step('1'), reply('r')], true).filter((i) => i.kind === 'activity')).toHaveLength(1);
  });

  it('counts failures and measures duration from the first start to the last end', () => {
    const items = groupTurns(
      [user('a'), step('1', { startedAt: 1000, endedAt: 2000 }), step('2', { result: 'Error: gone', startedAt: 2000, endedAt: 25_000 }), reply('r')],
      false,
    );
    const g = items[1];
    if (g.kind !== 'activity') throw new Error('expected activity');
    expect(g.group.failures).toBe(1);
    expect(g.group.durationMs).toBe(24_000);
  });

  it('leaves duration unset for history without timestamps', () => {
    const g = groupTurns([user('a'), step('1'), reply('r')], false)[1];
    expect(g.kind === 'activity' && g.group.durationMs).toBeUndefined();
  });

  it('gives every item a stable key', () => {
    const keys = groupTurns([user('a'), step('1'), reply('r')], false).map((i) => i.key);
    expect(new Set(keys).size).toBe(3);
    expect(groupTurns([user('a'), step('1'), reply('r')], false).map((i) => i.key)).toEqual(keys);
  });
});

describe('isFailed', () => {
  it('detects errors and rejections', () => {
    expect(isFailed(step('1', { result: 'Error: x' }))).toBe(true);
    expect(isFailed(step('1', { result: 'The user rejected this action.' }))).toBe(true);
    expect(isFailed(step('1'))).toBe(false);
  });
});

describe('formatDuration', () => {
  it('formats seconds and minutes', () => {
    expect(formatDuration(400)).toBe('<1s');
    expect(formatDuration(4200)).toBe('4s');
    expect(formatDuration(65_000)).toBe('1m 05s');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/ui/activity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/ui/activity.ts`**

```ts
import type { StepTurn, Turn } from '../types';

export interface ActivityGroup {
  steps: StepTurn[];
  live: boolean;
  failures: number;
  durationMs?: number;
}

export type ChatItem =
  | { kind: 'user'; turn: Extract<Turn, { kind: 'user' }>; key: string }
  | { kind: 'assistant'; text: string; key: string }
  | { kind: 'activity'; group: ActivityGroup; key: string };

export function isFailed(s: StepTurn): boolean {
  return s.result.startsWith('Error') || s.result.startsWith('The user rejected');
}

function finish(steps: StepTurn[], live: boolean): ActivityGroup {
  const starts = steps.map((s) => s.startedAt).filter((x): x is number => x !== undefined);
  const ends = steps.map((s) => s.endedAt).filter((x): x is number => x !== undefined);
  const g: ActivityGroup = { steps, live, failures: steps.filter(isFailed).length };
  if (starts.length && ends.length) g.durationMs = Math.max(...ends) - Math.min(...starts);
  return g;
}

/** Folds consecutive step turns into activity groups; the trailing group is live while running. */
export function groupTurns(turns: Turn[], running: boolean): ChatItem[] {
  const out: ChatItem[] = [];
  let pending: StepTurn[] = [];
  let pendingKey = '';
  const flush = (live: boolean) => {
    if (!pending.length && !live) return;
    out.push({ kind: 'activity', group: finish(pending, live), key: `a-${pendingKey || out.length}` });
    pending = [];
    pendingKey = '';
  };
  turns.forEach((t, i) => {
    if (t.kind === 'step') {
      if (!pending.length) pendingKey = t.id;
      pending.push(t);
      return;
    }
    flush(false);
    if (t.kind === 'user') out.push({ kind: 'user', turn: t, key: `u-${i}` });
    else out.push({ kind: 'assistant', text: t.text, key: `r-${i}` });
  });
  const lastIsUserOrStep = turns.length > 0 && turns[turns.length - 1].kind !== 'assistant';
  flush(running && lastIsUserOrStep);
  return out;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
```

Note: when `running` and the last turn is a step, `flush(true)` emits the pending steps as live. When `running` but the last turn is an assistant reply (between the final `conversation` update and `idle`), nothing live is added.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/ui/activity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/activity.ts tests/unit/ui/activity.test.ts
git commit -m "feat: group agent steps into activity cards"
```

---

### Task 6: Rounded animated cursor with action label

**Files:**
- Modify: `src/lib/content/overlay.ts` (whole file)
- Modify: `src/lib/content/protocol.ts:15`
- Modify: `src/lib/content/agent.ts:41`
- Modify: `src/lib/browser/driver.ts` (`perform`, `pointTo`, scroll move)
- Test: `tests/unit/content/overlay.test.ts`, `tests/unit/browser/driver.test.ts`

**Interfaces:**
- Produces:
  - Protocol: `{ type: 'overlay'; op: 'move'; x: number; y: number; label?: string }`
  - `Overlay.moveTo(x: number, y: number, label?: string): Promise<void>` — `label` undefined keeps the current label; `''` clears it.
  - `labelPlacement(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: boolean; above: boolean }` exported from `overlay.ts`.
  - `arcPoint(from: {x,y}, to: {x,y}): {x,y}` and `moveDuration(dist: number): number` exported from `overlay.ts`.
  - Overlay keeps class names `.border`, `.cursor`, `.ring`, `.highlight`, `.label`, `.ripple`; adds `.tag` (the action pill) and `.arrow`.

- [ ] **Step 1: Write failing overlay tests**

In `tests/unit/content/overlay.test.ts`, update the import to
`import { arcPoint, labelPlacement, moveDuration, Overlay, OVERLAY_HOST_ID } from '@/lib/content/overlay';`
and append inside `describe('Overlay', …)`:

```ts
  it('shows the action label with the cursor, keeps it across unlabeled moves, and clears it when inactive', async () => {
    const o = new Overlay(document, 0);
    o.setActive(true);
    await o.moveTo(10, 10, 'Click button "Nonstop only"');
    const tag = o.shadow.querySelector('.tag') as HTMLElement;
    expect(tag.textContent).toBe('Click button "Nonstop only"');
    expect(tag.classList.contains('on')).toBe(true);
    await o.moveTo(20, 20);
    expect(tag.textContent).toBe('Click button "Nonstop only"');
    o.setActive(false);
    expect(tag.classList.contains('on')).toBe(false);
    expect(tag.textContent).toBe('');
  });

  it('truncates long labels to 40 characters', async () => {
    const o = new Overlay(document, 0);
    await o.moveTo(0, 0, 'x'.repeat(60));
    expect(o.shadow.querySelector('.tag')!.textContent).toBe(`${'x'.repeat(39)}…`);
  });

  it('flips the label away from the right and bottom edges', () => {
    expect(labelPlacement(100, 100, 120, 22, 1000, 800)).toEqual({ left: false, above: false });
    expect(labelPlacement(950, 100, 120, 22, 1000, 800)).toEqual({ left: true, above: false });
    expect(labelPlacement(100, 790, 120, 22, 1000, 800)).toEqual({ left: false, above: true });
  });

  it('bends the path a little, more for longer moves but never past 60px', () => {
    const mid = arcPoint({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(mid.x).toBe(50);
    expect(Math.abs(mid.y)).toBeCloseTo(12, 0);
    const far = arcPoint({ x: 0, y: 0 }, { x: 2000, y: 0 });
    expect(Math.abs(far.y)).toBe(60);
    expect(arcPoint({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });

  it('scales move duration with distance between 180 and 450 ms', () => {
    expect(moveDuration(0)).toBe(180);
    expect(moveDuration(5000)).toBe(450);
    expect(moveDuration(400)).toBeGreaterThan(180);
    expect(moveDuration(400)).toBeLessThan(450);
  });
```

Keep the existing tests; the `moveTo` test still expects `style.transform === 'translate(120px, 80px)'` for the final position, and the ripple test still expects one `.ripple`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/content/overlay.test.ts`
Expected: FAIL — `labelPlacement`/`arcPoint`/`moveDuration` not exported, no `.tag`.

- [ ] **Step 3: Rewrite `src/lib/content/overlay.ts`**

```ts
import type { Rect } from '../types';

export const OVERLAY_HOST_ID = 'browser-control-overlay';

const ACCENT = '124, 92, 255';

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
.border { position: fixed; inset: 0; border: 2px solid rgba(${ACCENT}, .75); box-shadow: inset 0 0 28px rgba(${ACCENT}, .28); border-radius: 6px; opacity: 0; transition: opacity 250ms; }
.border.on { opacity: 1; }
.cursor { position: fixed; left: 0; top: 0; opacity: 0; transition: opacity 180ms; will-change: transform; }
.cursor.on { opacity: 1; }
.arrow { position: absolute; left: -4px; top: -3px; width: 24px; height: 24px; transform-origin: 4px 3px; transition: transform 140ms cubic-bezier(.3,.7,.4,1.4); filter: drop-shadow(0 2px 3px rgba(0,0,0,.28)); }
.cursor.on .arrow { animation: glow 2.4s ease-in-out infinite; }
.arrow.press { transform: scale(.82); }
@keyframes glow { 50% { filter: drop-shadow(0 0 6px rgba(${ACCENT}, .55)) drop-shadow(0 2px 3px rgba(0,0,0,.28)); } }
.tag { position: absolute; left: 18px; top: 20px; max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 3px 9px; border-radius: 999px; background: rgb(${ACCENT}); color: #fff; font: 600 11.5px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; box-shadow: 0 2px 8px rgba(${ACCENT}, .35); opacity: 0; transform: translateY(-2px); transition: opacity 150ms, transform 150ms; }
.tag.on { opacity: 1; transform: none; }
.tag.left { left: auto; right: 10px; }
.tag.above { top: auto; bottom: 10px; }
.ring { position: fixed; display: none; border: 2px solid rgba(${ACCENT}, .85); border-radius: 8px; background: rgba(${ACCENT}, .07); transition: all 160ms ease-out; }
.highlight { position: fixed; display: none; border: 2px solid #f5a524; border-radius: 8px; background: rgba(245, 165, 36, .12); }
.label { position: absolute; top: -26px; left: 0; background: #f5a524; color: #111; font: 600 12px/1.6 -apple-system, "Segoe UI", system-ui, sans-serif; padding: 0 8px; border-radius: 6px; white-space: nowrap; }
.ripple { position: fixed; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; background: rgba(${ACCENT}, .35); animation: pulse 450ms ease-out forwards; }
@keyframes pulse { from { transform: scale(.35); opacity: .9; } to { transform: scale(1.6); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .cursor.on .arrow { animation: none; }
  .arrow { transition: none; }
}
`;

const ARROW_SVG = `<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 3.2c-.6-.3-1.3.3-1.1.9l5.3 15.6c.2.7 1.2.7 1.4 0l1.9-5.6c.1-.3.3-.5.6-.6l5.6-1.9c.7-.2.7-1.2 0-1.4z" fill="rgb(${ACCENT})" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

const MAX_LABEL = 40;

interface Pt {
  x: number;
  y: number;
}

/** Mid-point of a gently curved path: offset perpendicular to travel by 12% of the distance, at most 60px. */
export function arcPoint(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const mid = { x: from.x + dx / 2, y: from.y + dy / 2 };
  if (dist === 0) return mid;
  const bend = Math.min(60, dist * 0.12);
  return { x: mid.x + (-dy / dist) * bend, y: mid.y + (dx / dist) * bend };
}

/** 180ms for tiny moves up to 450ms for long ones. */
export function moveDuration(dist: number): number {
  return Math.round(Math.min(450, 180 + Math.sqrt(dist) * 9));
}

/** Which side of the cursor the label pill goes so it stays inside the viewport. */
export function labelPlacement(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: boolean; above: boolean } {
  return { left: x + 18 + w > vw - 8, above: y + 20 + h > vh - 8 };
}

function box(el: HTMLElement, rect: Rect | null): void {
  if (!rect) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.style.left = `${rect.x - 3}px`;
  el.style.top = `${rect.y - 3}px`;
  el.style.width = `${rect.w + 6}px`;
  el.style.height = `${rect.h + 6}px`;
}

export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private layer: HTMLElement;
  private border: HTMLElement;
  private cursor: HTMLElement;
  private arrow: SVGElement;
  private tag: HTMLElement;
  private ring: HTMLElement;
  private hl: HTMLElement;
  private hlLabel: HTMLElement;
  private pos: Pt;

  /** `moveMs` 0 disables animation (tests); otherwise duration scales with distance. */
  constructor(
    private doc: Document,
    private moveMs = 300,
  ) {
    doc.querySelectorAll(`#${OVERLAY_HOST_ID}`).forEach((stale) => stale.remove()); // from a reloaded extension
    this.host = doc.createElement('div');
    this.host.id = OVERLAY_HOST_ID;
    this.root = this.host.attachShadow({ mode: 'closed' });
    this.root.innerHTML = `<style>${STYLE}</style><div class="layer"><div class="border"></div><div class="ring"></div><div class="highlight"><span class="label"></span></div><div class="cursor">${ARROW_SVG}<span class="tag"></span></div></div>`;
    const q = <T extends Element = HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.layer = q('.layer');
    this.border = q('.border');
    this.cursor = q('.cursor');
    this.arrow = q<SVGElement>('.arrow');
    this.tag = q('.tag');
    this.ring = q('.ring');
    this.hl = q('.highlight');
    this.hlLabel = q('.label');
    const win = doc.defaultView;
    this.pos = { x: (win?.innerWidth ?? 800) / 2, y: (win?.innerHeight ?? 600) / 2 };
    this.place(this.pos.x, this.pos.y);
    this.attach();
  }

  /** Test hook: the shadow root is closed to page scripts. */
  get shadow(): ShadowRoot {
    return this.root;
  }

  private attach(): void {
    if (!this.host.isConnected) this.doc.documentElement.appendChild(this.host);
  }

  private place(x: number, y: number): void {
    this.cursor.style.transform = `translate(${x}px, ${y}px)`;
  }

  private reducedMotion(): boolean {
    return this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private setLabel(label: string | undefined): void {
    if (label === undefined) return;
    const text = label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
    this.tag.textContent = text;
    this.tag.classList.toggle('on', !!text);
  }

  private placeLabel(x: number, y: number): void {
    const win = this.doc.defaultView;
    const w = this.tag.offsetWidth || this.tag.textContent!.length * 7 + 18;
    const p = labelPlacement(x, y, w, 22, win?.innerWidth ?? 1e6, win?.innerHeight ?? 1e6);
    this.tag.classList.toggle('left', p.left);
    this.tag.classList.toggle('above', p.above);
  }

  setActive(on: boolean): void {
    this.attach();
    this.border.classList.toggle('on', on);
    this.cursor.classList.toggle('on', on);
    if (!on) {
      this.setLabel('');
      this.hover(null);
      this.highlight(null);
    }
  }

  moveTo(x: number, y: number, label?: string): Promise<void> {
    this.attach();
    this.cursor.classList.add('on');
    this.setLabel(label);
    this.placeLabel(x, y);
    const from = this.pos;
    this.pos = { x, y };
    this.place(x, y);
    if (this.moveMs === 0) return Promise.resolve();
    const reduced = this.reducedMotion();
    const ms = reduced ? 120 : moveDuration(Math.hypot(x - from.x, y - from.y));
    const mid = reduced ? { x: (from.x + x) / 2, y: (from.y + y) / 2 } : arcPoint(from, { x, y });
    const anim = this.cursor.animate?.(
      [
        { transform: `translate(${from.x}px, ${from.y}px)` },
        { transform: `translate(${mid.x}px, ${mid.y}px)`, offset: 0.5 },
        { transform: `translate(${x}px, ${y}px)` },
      ],
      { duration: ms, easing: 'cubic-bezier(.45,0,.2,1)' },
    );
    return new Promise((resolve) => {
      if (anim) anim.onfinish = () => resolve();
      setTimeout(resolve, ms + 50); // in case the animation is cancelled or unsupported
    });
  }

  click(x: number, y: number): void {
    this.attach();
    this.arrow.classList.add('press');
    setTimeout(() => this.arrow.classList.remove('press'), 140);
    const ripple = this.doc.createElement('div');
    ripple.className = 'ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    this.layer.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
  }

  hover(rect: Rect | null): void {
    this.attach();
    box(this.ring, rect);
  }

  highlight(rect: Rect | null, label?: string): void {
    this.attach();
    box(this.hl, rect);
    this.hlLabel.textContent = label ?? '';
    this.hlLabel.style.display = label ? '' : 'none';
  }
}
```

- [ ] **Step 4: Run overlay tests**

Run: `npx vitest run tests/unit/content/overlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the label through protocol, content agent and driver**

`src/lib/content/protocol.ts` line 15:

```ts
  | { type: 'overlay'; op: 'move'; x: number; y: number; label?: string }
```

`src/lib/content/agent.ts` in `case 'move':`:

```ts
            await ov().moveTo(req.x, req.y, req.label);
```

`src/lib/browser/driver.ts`:
- Add import `import { describeCall } from '../agent/tools';`
- Add field `private stepLabel: string | undefined;`
- In `perform`, first line: `this.stepLabel = describeCall(call, target);`
- In `pointTo`, the move becomes `{ type: 'overlay', op: 'move', x: t.point.x, y: t.point.y, label: this.stepLabel }`.
- In `case 'scroll'`, the move becomes `{ type: 'overlay', op: 'move', x, y, label: this.stepLabel }`.
- Leave the focus-follow move in `case 'key'` without a label.

- [ ] **Step 6: Add a driver test for the label**

In `tests/unit/browser/driver.test.ts`, inside the `setup()` helper: add `const labels: string[] = [];` next to `const fitted: string[] = [];`, add this line as the first statement of `content.send`:

```ts
      if (req.type === 'overlay' && req.op === 'move' && req.label) labels.push(req.label);
```

and add `labels,` to the object `setup()` returns. Then, after the `'moves the overlay cursor before the real click'` test, add:

```ts
  it('sends the step description with cursor moves so the page can label the cursor', async () => {
    const { driver, labels } = setup();
    const t = await driver.target(call('click', { id: 4 }));
    await driver.perform(call('click', { id: 4 }), t, 'compact');
    expect(labels).toEqual(['Click button "Go"']);
  });

  it('keeps the label off focus-follow moves after a key press', async () => {
    const { driver, labels } = setup();
    const t = await driver.target(call('key', { combo: 'Tab' }));
    await driver.perform(call('key', { combo: 'Tab' }), t, 'compact');
    expect(labels.every((l) => l.startsWith('Press'))).toBe(true);
  });
```

If `describeCall` words the click label differently (check `src/lib/agent/tools.ts` `describeCall` for `click`), copy its exact output for element `button "Go"` into the first expectation.

- [ ] **Step 7: Run unit tests + compile**

Run: `npm test && npm run compile`
Expected: PASS. Check `tsc` does not report a circular import problem (`tools.ts` imports only types/util/url/policy, so none).

- [ ] **Step 8: Commit**

```bash
git add src/lib/content/overlay.ts src/lib/content/protocol.ts src/lib/content/agent.ts src/lib/browser/driver.ts tests/unit/content/overlay.test.ts tests/unit/browser/driver.test.ts
git commit -m "feat: rounded animated cursor with an action label"
```

---

### Task 7: Theme tokens, icons, theme hook and safe Markdown

**Files:**
- Modify: `package.json` (deps)
- Create: `src/lib/ui/theme.css`, `src/lib/ui/useTheme.ts`, `src/lib/ui/icons.tsx`
- Create: `src/entrypoints/sidepanel/components/Markdown.tsx`
- Test: `tests/unit/ui/markdown.test.tsx`

**Interfaces:**
- Produces:
  - CSS custom properties: `--bg --surface --surface-2 --border --fg --muted --faint --accent --accent-fg --accent-soft --accent-text --warn --warn-bg --warn-border --danger --danger-bg --ok --ok-bg --shadow --shadow-lg --radius --radius-lg --font --mono`
  - `useTheme(): void` — reads `settings.theme`, sets `document.documentElement.dataset.theme`.
  - Icons (each `(p: { size?: number }) => JSX.Element`, `aria-hidden`): `IconNewChat, IconHistory, IconSettings, IconPaperclip, IconSend, IconStop, IconChevronDown, IconChevronRight, IconCheck, IconX, IconWarning, IconGlobe, IconFile, IconCopy, IconRefresh, IconSparkle, IconSpinner, IconBack`
  - `Markdown({ text }: { text: string })`, plus exported `safeHref(href: string | undefined): string | undefined`.

- [ ] **Step 1: Install dependencies**

Run: `npm install react-markdown@^10.1.0 remark-gfm@^4.0.1`
Expected: both added to `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing Markdown test**

Create `tests/unit/ui/markdown.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown, safeHref } from '@/entrypoints/sidepanel/components/Markdown';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('Markdown', () => {
  it('renders GFM lists, tables, emphasis and code', () => {
    const out = html('# Hi\n\n- **one**\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nUse `npm test`.');
    expect(out).toContain('<h1>Hi</h1>');
    expect(out).toContain('<strong>one</strong>');
    expect(out).toContain('<table>');
    expect(out).toContain('<code>npm test</code>');
  });

  it('opens safe links in a new tab', () => {
    expect(html('[site](https://example.com)')).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a>');
  });

  it('never renders raw HTML or script links', () => {
    const out = html('<script>alert(1)</script> <img src=x onerror="alert(1)"> [x](javascript:alert(1))');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('<a ');
  });

  it('wraps tables so they scroll instead of stretching the panel', () => {
    expect(html('| a |\n|---|\n| 1 |')).toContain('class="md-table"');
  });
});

describe('safeHref', () => {
  it('allows only http, https and mailto', () => {
    expect(safeHref('https://a.b')).toBe('https://a.b');
    expect(safeHref('mailto:x@y.z')).toBe('mailto:x@y.z');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,hi')).toBeUndefined();
    expect(safeHref('/relative')).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/ui/markdown.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `Markdown.tsx`**

```tsx
import { type ReactNode, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { IconCheck, IconCopy } from '@/lib/ui/icons';

export function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:' ? href : undefined;
  } catch {
    return undefined;
  }
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-pre">
      <button
        className="md-copy"
        aria-label="Copy code"
        onClick={(e) => {
          const text = (e.currentTarget.nextElementSibling as HTMLElement | null)?.innerText ?? '';
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

const components: Components = {
  a: ({ href, children }) => {
    const safe = safeHref(href);
    return safe ? (
      <a href={safe} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
  img: ({ alt }) => <span>{alt}</span>,
};

/** Assistant text as GitHub-flavoured markdown. Raw HTML is never rendered (no rehype-raw). */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={(url) => safeHref(url) ?? ''}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
```

Note: `react-markdown` escapes raw HTML by default (`skipHtml` not needed; HTML nodes are dropped without `rehype-raw`). `urlTransform` returning `''` plus the `a` override turns unsafe links into plain spans.

- [ ] **Step 5: Implement `src/lib/ui/icons.tsx`**

```tsx
import type { ReactNode } from 'react';

type P = { size?: number };

function svg(path: ReactNode, { size = 18 }: P, fill = false) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path}
    </svg>
  );
}

export const IconNewChat = (p: P) => svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>, p);
export const IconHistory = (p: P) => svg(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>, p);
export const IconSettings = (p: P) => svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>, p);
export const IconPaperclip = (p: P) => svg(<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />, p);
export const IconSend = (p: P) => svg(<><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>, p);
export const IconStop = (p: P) => svg(<rect x="7" y="7" width="10" height="10" rx="2" />, p, true);
export const IconChevronDown = (p: P) => svg(<path d="m6 9 6 6 6-6" />, p);
export const IconChevronRight = (p: P) => svg(<path d="m9 6 6 6-6 6" />, p);
export const IconCheck = (p: P) => svg(<path d="M20 6 9 17l-5-5" />, p);
export const IconX = (p: P) => svg(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>, p);
export const IconWarning = (p: P) => svg(<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>, p);
export const IconGlobe = (p: P) => svg(<><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z" /></>, p);
export const IconFile = (p: P) => svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></>, p);
export const IconCopy = (p: P) => svg(<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>, p);
export const IconRefresh = (p: P) => svg(<><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>, p);
export const IconSparkle = (p: P) => svg(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />, p);
export const IconSpinner = (p: P) => svg(<path d="M21 12a9 9 0 1 1-6.2-8.6" className="spin" />, p);
export const IconBack = (p: P) => svg(<path d="m15 18-6-6 6-6" />, p);
```

- [ ] **Step 6: Implement `src/lib/ui/theme.css`**

```css
:root {
  --bg: #ffffff; --surface: #fafafb; --surface-2: #f4f4f5; --border: #ececf1; --border-strong: #e4e4e9;
  --fg: #18181b; --muted: #71717a; --faint: #a1a1aa;
  --accent: #7c5cff; --accent-fg: #ffffff; --accent-soft: #efeaff; --accent-text: #5b3fe0;
  --warn: #b45309; --warn-bg: #fffbeb; --warn-border: #fde1a6;
  --danger: #dc2626; --danger-bg: #fef2f2; --ok: #16a34a; --ok-bg: #e8f7ee;
  --shadow: 0 2px 10px rgba(24, 24, 27, .06); --shadow-lg: 0 12px 32px rgba(24, 24, 27, .18);
  --radius: 10px; --radius-lg: 18px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --bg: #111114; --surface: #18181d; --surface-2: #202026; --border: #2a2a31; --border-strong: #34343c;
  --fg: #ececf1; --muted: #9a9aa8; --faint: #6b6b76;
  --accent-soft: #2a2346; --accent-text: #b8a6ff;
  --warn: #fbbf24; --warn-bg: #2a2210; --warn-border: #4a3a12;
  --danger: #f87171; --danger-bg: #2a1414; --ok: #4ade80; --ok-bg: #12261a;
  --shadow: 0 2px 10px rgba(0, 0, 0, .35); --shadow-lg: 0 12px 32px rgba(0, 0, 0, .55);
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  :root[data-theme="system"], :root:not([data-theme]) {
    --bg: #111114; --surface: #18181d; --surface-2: #202026; --border: #2a2a31; --border-strong: #34343c;
    --fg: #ececf1; --muted: #9a9aa8; --faint: #6b6b76;
    --accent-soft: #2a2346; --accent-text: #b8a6ff;
    --warn: #fbbf24; --warn-bg: #2a2210; --warn-border: #4a3a12;
    --danger: #f87171; --danger-bg: #2a1414; --ok: #4ade80; --ok-bg: #12261a;
    --shadow: 0 2px 10px rgba(0, 0, 0, .35); --shadow-lg: 0 12px 32px rgba(0, 0, 0, .55);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); font: 13.5px/1.5 var(--font); -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; cursor: pointer; }
button:disabled { cursor: default; opacity: .45; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.spin { transform-origin: center; animation: spin 900ms linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.shimmer { background: linear-gradient(90deg, var(--faint) 0%, var(--fg) 50%, var(--faint) 100%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shimmer 2s linear infinite; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .shimmer, .spin { animation: none; } .shimmer { color: var(--muted); background: none; } }
```

- [ ] **Step 7: Implement `src/lib/ui/useTheme.ts`**

```ts
import { useEffect } from 'react';
import { chromeKV } from '../storage/kv';
import { SettingsStore } from '../storage/settings';

export function useTheme(): void {
  useEffect(() => {
    const store = new SettingsStore(chromeKV());
    const apply = async () => {
      document.documentElement.dataset.theme = (await store.get()).theme;
    };
    void apply();
    const onChanged = (changes: Record<string, unknown>) => {
      if ('settings' in changes) void apply();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
}
```

- [ ] **Step 8: Run tests + compile**

Run: `npx vitest run tests/unit/ui/markdown.test.tsx && npm run compile`
Expected: PASS. If Vitest cannot transform `.tsx`, confirm `tsconfig.json` has `"jsx": "react-jsx"` (it does) — Vitest's esbuild reads it.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/lib/ui/theme.css src/lib/ui/useTheme.ts src/lib/ui/icons.tsx src/entrypoints/sidepanel/components/Markdown.tsx tests/unit/ui/markdown.test.tsx
git commit -m "feat: theme tokens, icons and safe markdown rendering"
```

---

### Task 8: Side panel rebuild

**Files:**
- Create: `src/entrypoints/sidepanel/components/Header.tsx`, `ActivityCard.tsx`, `AttachmentTray.tsx`, `ModelMenu.tsx`, `TabChip.tsx`
- Rewrite: `ChatView.tsx`, `Composer.tsx`, `GateCard.tsx`, `HistoryList.tsx`, `App.tsx`, `style.css`, `main.tsx`
- Delete: `StepCard.tsx`, `ProfilePicker.tsx`

**Interfaces:**
- Consumes: `groupTurns`, `formatDuration`, `isFailed`, `ChatItem`, `ActivityGroup` (Task 5); `Markdown` + icons + `useTheme` (Task 7); `menuGroups`, `prettyModel`, `supportsVisionFor`, `canSend` (Task 1); `useModelCatalog`, `selectModel` (Task 4); `Attachment.meta` (Task 3); `StepTurn.thinking/thinkingMs` (Task 2); `useProfiles()` returns `{ profiles, activeId, active, setActive }`; `usePanelPort()` returns `{ state, dispatch, send }`.
- Produces: no new library interfaces; DOM contract in Global Constraints.

This task is UI-only; its verification is compile, the existing e2e suite, and the new e2e checks in Task 10. Build each file, then run the gates at the end.

- [ ] **Step 1: `main.tsx` imports the theme**

```tsx
import { createRoot } from 'react-dom/client';
import '@/lib/ui/theme.css';
import { App } from './App';
import './style.css';

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 2: `Header.tsx`**

```tsx
import { IconBack, IconHistory, IconNewChat, IconSettings } from '@/lib/ui/icons';

interface Props {
  title: string;
  view: 'chat' | 'history';
  busy: boolean;
  onNew(): void;
  onToggleHistory(): void;
}

export function Header({ title, view, busy, onNew, onToggleHistory }: Props) {
  return (
    <header className="hd">
      {view === 'history' ? (
        <button className="icon-btn" aria-label="Back to chat" title="Back to chat" onClick={onToggleHistory}>
          <IconBack />
        </button>
      ) : null}
      <span className="hd-title" title={title}>{view === 'history' ? 'History' : title}</span>
      <button className="icon-btn" aria-label="New chat" title="New chat" onClick={onNew} disabled={busy}>
        <IconNewChat />
      </button>
      <button className="icon-btn" aria-label="History" title="History" aria-pressed={view === 'history'} onClick={onToggleHistory} disabled={busy}>
        <IconHistory />
      </button>
      <button className="icon-btn" aria-label="Settings" title="Settings" onClick={() => chrome.runtime.openOptionsPage()}>
        <IconSettings />
      </button>
    </header>
  );
}
```

- [ ] **Step 3: `ActivityCard.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { StepTurn } from '@/lib/types';
import { type ActivityGroup, formatDuration, isFailed } from '@/lib/ui/activity';
import { IconCheck, IconChevronDown, IconChevronRight, IconSparkle, IconSpinner, IconWarning, IconX } from '@/lib/ui/icons';

function ThinkingRow({ text, ms }: { text: string; ms?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <button className="act-row think" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
      <span className="act-ic"><IconSparkle size={13} /></span>
      <span className="act-main">
        <span className="muted">{ms ? `Thought for ${formatDuration(ms)}` : 'Thought'}</span>
        <span className={open ? 'think-full' : 'think-preview'}>{text}</span>
      </span>
    </button>
  );
}

function StepRow({ step }: { step: StepTurn }) {
  const [open, setOpen] = useState(false);
  const failed = isFailed(step);
  const shot = step.observation?.screenshot;
  const thought = step.thinking || step.reasoning;
  return (
    <>
      {thought && <ThinkingRow text={thought} ms={step.thinkingMs} />}
      <button className={`act-row${open ? ' open' : ''}${failed ? ' failed' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`act-ic ${failed ? 'bad' : 'ok'}`}>{failed ? <IconX size={13} /> : <IconCheck size={13} />}</span>
        <span className="act-label">{step.label}</span>
        {step.risky && <span className="badge">approval</span>}
        {shot && !open && <img className="thumb" src={shot} alt="" />}
      </button>
      {open && (
        <div className="act-detail">
          {shot && <img className="shot" src={shot} alt="Page before this step" />}
          <pre className="result">{step.result}</pre>
        </div>
      )}
    </>
  );
}

interface Props {
  group: ActivityGroup;
  streaming: string;
  reasoning: string;
}

export function ActivityCard({ group, streaming, reasoning }: Props) {
  const [open, setOpen] = useState(group.live);
  useEffect(() => {
    setOpen(group.live);
  }, [group.live]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!group.live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [group.live]);

  const n = group.steps.length;
  const firstStart = group.steps[0]?.startedAt;
  const elapsed = group.live ? (firstStart ? now - firstStart : undefined) : group.durationMs;
  const title = group.live ? `Working · step ${n + 1}` : `Worked through ${n} step${n === 1 ? '' : 's'}`;

  return (
    <div className={`act${group.live ? ' live' : ''}`}>
      <button className="act-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        <span className={group.live ? 'shimmer act-title' : 'act-title'}>{title}</span>
        {group.failures > 0 && (
          <span className="act-fail"><IconWarning size={12} /> {group.failures}</span>
        )}
        {elapsed !== undefined && <span className="muted act-time">{formatDuration(elapsed)}</span>}
      </button>
      {open && (
        <div className="act-body">
          {group.steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
          {group.live && (
            <div className="act-row live-row" data-testid="thinking">
              <span className="act-ic"><IconSpinner size={13} /></span>
              <span className="act-main">
                {streaming ? (
                  <span className="think-preview">{streaming.slice(-400)}</span>
                ) : reasoning ? (
                  <>
                    <span className="shimmer">Thinking…</span>
                    <span className="think-preview">{reasoning.slice(-400)}</span>
                  </>
                ) : (
                  <span className="shimmer">Working…</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `ChatView.tsx`**

```tsx
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Turn } from '@/lib/types';
import { groupTurns } from '@/lib/ui/activity';
import { IconFile } from '@/lib/ui/icons';
import { ActivityCard } from './ActivityCard';
import { Markdown } from './Markdown';

interface Props {
  turns: Turn[];
  streaming: string;
  reasoning: string;
  running: boolean;
}

export function ChatView({ turns, streaming, reasoning, running }: Props) {
  const items = useMemo(() => groupTurns(turns, running), [turns, running]);
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = box.current!;
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    if (pinned.current) box.current!.scrollTop = box.current!.scrollHeight;
  }, [items, streaming, reasoning]);

  return (
    <div className="chat" ref={box}>
      {items.length === 0 && (
        <div className="empty">
          <div className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4.5 3.2c-.6-.3-1.3.3-1.1.9l5.3 15.6c.2.7 1.2.7 1.4 0l1.9-5.6c.1-.3.3-.5.6-.6l5.6-1.9c.7-.2.7-1.2 0-1.4z" fill="#fff" /></svg>
          </div>
          <h2>What should I do in this tab?</h2>
          <p>I'll ask before using a new site or doing anything risky.</p>
        </div>
      )}
      {items.map((it) => {
        if (it.kind === 'activity') return <ActivityCard key={it.key} group={it.group} streaming={streaming} reasoning={reasoning} />;
        if (it.kind === 'assistant') return <Markdown key={it.key} text={it.text} />;
        return (
          <div key={it.key} className="user-msg">
            {it.turn.attachments.length > 0 && (
              <div className="user-atts">
                {it.turn.attachments.map((a, i) =>
                  a.kind === 'image' && a.dataUrl ? (
                    <img key={i} src={a.dataUrl} alt={a.name} />
                  ) : (
                    <span key={i} className="user-file"><IconFile size={13} /> {a.name}</span>
                  ),
                )}
              </div>
            )}
            <div className="bubble">{it.turn.text}</div>
          </div>
        );
      })}
    </div>
  );
}
```

Streaming text renders inside the live activity row (`streaming.slice(-400)`), not as a separate message, so it does not jump into the answer slot before `done`. The final answer arrives as an assistant turn and renders through `Markdown`.

- [ ] **Step 5: `GateCard.tsx`**

```tsx
import { useState } from 'react';
import { IconGlobe, IconWarning } from '@/lib/ui/icons';
import type { PendingGate } from '@/lib/ui/panelState';

export function GateCard({ gate, onAnswer }: { gate: PendingGate; onAnswer: (value: string | boolean) => void }) {
  const [answer, setAnswer] = useState('');
  const r = gate.request;
  switch (r.kind) {
    case 'site':
      return (
        <div className="gate" role="dialog" aria-label="Site permission">
          <p className="gate-title"><IconGlobe size={15} /> Allow access to this site?</p>
          <p className="gate-desc">The agent wants to read and act on <strong>{r.origin}</strong>.</p>
          <div className="gate-actions">
            <button className="btn primary" onClick={() => onAnswer('once')}>Allow once</button>
            <button className="btn" onClick={() => onAnswer('always')}>Always allow</button>
            <button className="btn ghost danger" onClick={() => onAnswer('deny')}>Deny</button>
          </div>
        </div>
      );
    case 'risky':
      return (
        <div className="gate gate-risky" role="dialog" aria-label="Approve action">
          <p className="gate-title"><IconWarning size={15} /> Approve this action?</p>
          <p className="gate-desc">{r.description}</p>
          <ul className="gate-reasons">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
          {r.reason && <p className="gate-why">Model's reason: {r.reason}</p>}
          <div className="gate-actions">
            <button className="btn primary" onClick={() => onAnswer(true)}>Approve</button>
            <button className="btn" onClick={() => onAnswer(false)}>Reject</button>
          </div>
        </div>
      );
    case 'ask':
      return (
        <div className="gate" role="dialog" aria-label="Question from the agent">
          <p className="gate-desc">{r.question}</p>
          <input
            className="gate-input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && answer.trim() && onAnswer(answer.trim())}
            autoFocus
          />
          <div className="gate-actions">
            <button className="btn primary" disabled={!answer.trim()} onClick={() => onAnswer(answer.trim())}>Send answer</button>
          </div>
        </div>
      );
    case 'retry':
      return (
        <div className="gate gate-error" role="dialog" aria-label="Task paused">
          <p className="gate-desc">{r.message}</p>
          <div className="gate-actions">
            <button className="btn primary" onClick={() => onAnswer(true)}>Retry</button>
            <button className="btn" onClick={() => onAnswer(false)}>Stop</button>
          </div>
        </div>
      );
  }
}
```

- [ ] **Step 6: `AttachmentTray.tsx`**

```tsx
import type { Attachment } from '@/lib/types';
import { IconFile, IconX } from '@/lib/ui/icons';

export function AttachmentTray({ items, onRemove }: { items: Attachment[]; onRemove(i: number): void }) {
  if (!items.length) return null;
  return (
    <div className="tray">
      {items.map((a, i) => (
        <div key={`${a.name}-${i}`} className={a.kind === 'image' ? 'att-img' : 'att-file'} title={a.name}>
          {a.kind === 'image' && a.dataUrl ? (
            <img src={a.dataUrl} alt={a.name} />
          ) : (
            <>
              <span className="att-badge">{a.name.split('.').pop()?.slice(0, 4).toUpperCase() || <IconFile size={14} />}</span>
              <span className="att-text">
                <span className="att-name">{a.name}</span>
                {a.meta && <span className="att-meta">{a.meta}</span>}
              </span>
            </>
          )}
          <button className="att-x" aria-label={`Remove ${a.name}`} onClick={() => onRemove(i)}>
            <IconX size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: `ModelMenu.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Profile } from '@/lib/types';
import { IconCheck, IconChevronDown, IconRefresh, IconSettings, IconWarning } from '@/lib/ui/icons';
import { type CatalogEntry, menuGroups, prettyModel, supportsVisionFor } from '@/lib/ui/models';

interface Props {
  profiles: Profile[];
  active: Profile | null;
  catalog: Record<string, CatalogEntry>;
  refreshing: Set<string>;
  disabled: boolean;
  onOpen(): void;
  onRefresh(p: Profile): void;
  onSelect(profileId: string, model: string): void;
}

export function ModelMenu({ profiles, active, catalog, refreshing, disabled, onOpen, onRefresh, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => menuGroups(profiles, catalog, query), [profiles, catalog, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.models.map((m) => ({ profileId: g.profileId, model: m }))), [groups]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => setCursor(0), [query]);

  const choose = (profileId: string, model: string) => {
    onSelect(profileId, model);
    setOpen(false);
    setQuery('');
  };

  let idx = -1;
  return (
    <div className="mm" ref={root}>
      <button
        className={`pill${open ? ' on' : ''}`}
        aria-label="Model"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={active ? `${active.name} · ${active.model}` : 'Choose a model'}
        disabled={disabled}
        onClick={() => {
          if (!open) onOpen();
          setOpen((o) => !o);
        }}
      >
        {prettyModel(active?.model ?? '')} <IconChevronDown size={12} />
      </button>
      {open && (
        <div className="mm-pop" role="listbox" aria-label="Models">
          <input
            className="mm-search"
            placeholder="Search models…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(flat.length - 1, c + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === 'Enter' && flat[cursor]) {
                choose(flat[cursor].profileId, flat[cursor].model);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          <div className="mm-list">
            {groups.map((g) => {
              const p = profiles.find((x) => x.id === g.profileId)!;
              return (
                <div key={g.profileId}>
                  <div className="mm-group">
                    <span>{g.name}</span>
                    <button className="icon-btn sm" aria-label={`Refresh ${g.name}`} title="Refresh models" onClick={() => onRefresh(p)}>
                      <IconRefresh size={12} />
                    </button>
                  </div>
                  {g.models.map((m) => {
                    idx++;
                    const selected = active?.id === g.profileId && active.model === m;
                    return (
                      <button
                        key={m}
                        role="option"
                        aria-selected={selected}
                        className={`mm-opt${idx === cursor ? ' hot' : ''}${selected ? ' sel' : ''}`}
                        onClick={() => choose(g.profileId, m)}
                      >
                        <span className="mm-name">{m}</span>
                        {supportsVisionFor(p, m) && <span className="tag">vision</span>}
                        {selected && <IconCheck size={14} />}
                      </button>
                    );
                  })}
                  {refreshing.has(g.profileId) && g.models.length === 0 && <div className="mm-note muted">Loading…</div>}
                  {g.error && (
                    <div className="mm-note warn"><IconWarning size={12} /> Couldn't reach {g.name} — showing last known models</div>
                  )}
                </div>
              );
            })}
            {groups.length === 0 && <div className="mm-note muted">No models match “{query}”.</div>}
          </div>
          <button className="mm-foot" onClick={() => chrome.runtime.openOptionsPage()}>
            <IconSettings size={14} /> Manage providers…
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: `TabChip.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { IconGlobe } from '@/lib/ui/icons';
import { targetTabId } from '@/lib/ui/targetTab';

export function TabChip() {
  const [tab, setTab] = useState<{ title: string; icon?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const id = await targetTabId();
      if (id === undefined) return;
      const t = await chrome.tabs.get(id).catch(() => null);
      if (alive && t) setTab({ title: t.title || t.url || 'this tab', icon: t.favIconUrl });
    };
    void load();
    const onUpdated = () => void load();
    chrome.tabs.onActivated.addListener(onUpdated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      alive = false;
      chrome.tabs.onActivated.removeListener(onUpdated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  if (!tab) return null;
  return (
    <div className="tabchip" title={tab.title}>
      {tab.icon ? <img src={tab.icon} alt="" /> : <IconGlobe size={12} />}
      <span>Working in: {tab.title}</span>
    </div>
  );
}
```

- [ ] **Step 9: `Composer.tsx`**

```tsx
import { type ReactNode, useRef, useState } from 'react';
import { readAttachment } from '@/lib/attachments';
import type { Attachment } from '@/lib/types';
import { IconPaperclip, IconSend, IconStop } from '@/lib/ui/icons';
import { AttachmentTray } from './AttachmentTray';

interface Props {
  running: boolean;
  vision: boolean;
  ready: boolean;
  modelMenu: ReactNode;
  onSend(text: string, attachments: Attachment[]): void;
  onStop(): void;
}

export function Composer({ running, vision, ready, modelMenu, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  async function addFiles(files: File[]) {
    setErr(null);
    for (const f of files) {
      try {
        const a = await readAttachment(f);
        if (a.kind === 'image' && !vision) {
          setErr(`"${f.name}" is an image, but the selected model does not support images.`);
          continue;
        }
        setAtts((prev) => [...prev, a]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    }
  }

  function grow() {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function submit() {
    const t = text.trim();
    if (!t || running || !ready) return;
    onSend(t, atts);
    setText('');
    setAtts([]);
    requestAnimationFrame(grow);
  }

  return (
    <div
      className={`composer${dragging ? ' dragging' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {dragging && <div className="dropzone">Drop files to attach</div>}
      <AttachmentTray items={atts} onRemove={(i) => setAtts((p) => p.filter((_, j) => j !== i))} />
      {err && <div className="composer-error" role="alert">{err}</div>}
      <textarea
        ref={area}
        data-testid="composer-input"
        value={text}
        placeholder="Ask anything…"
        rows={1}
        onChange={(e) => {
          setText(e.target.value);
          grow();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
      />
      <div className="composer-bar">
        <button className="icon-btn" aria-label="Attach files" title="Attach images, PDFs or text files" onClick={() => fileRef.current?.click()} disabled={running}>
          <IconPaperclip />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
        {modelMenu}
        {running ? (
          <button className="round-btn stop" aria-label="Stop" data-testid="composer-stop" onClick={onStop}>
            <IconStop size={14} />
          </button>
        ) : (
          <button
            className="round-btn"
            aria-label="Send"
            data-testid="composer-send"
            title={ready ? 'Send' : 'Choose a model first'}
            onClick={submit}
            disabled={!text.trim() || !ready}
          >
            <IconSend size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
```

Note on the drop zone: the spec says "full-panel drop zone". Put the drag handlers on the `.app` root in `App.tsx` instead of `.composer` if the composer-only target feels too small during manual check; keep `addFiles` in `Composer` and forward files via a ref callback. Start with the composer-level version above — it already covers the whole bottom card and the `.dropzone` overlay is `position: fixed; inset: 0` so it visually fills the panel.

- [ ] **Step 10: `HistoryList.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HistoryStore } from '@/lib/storage/history';
import { chromeKV } from '@/lib/storage/kv';
import type { Conversation, ConversationMeta } from '@/lib/types';
import { IconX } from '@/lib/ui/icons';

function relative(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function HistoryList({ onOpen }: { onOpen: (c: Conversation) => void }) {
  const store = useMemo(() => new HistoryStore(chromeKV()), []);
  const [items, setItems] = useState<ConversationMeta[]>([]);
  const refresh = useCallback(async () => setItems(await store.list()), [store]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!items.length) return <p className="empty-note">No saved chats yet.</p>;
  return (
    <ul className="history">
      {items.map((m) => (
        <li key={m.id}>
          <button
            className="history-open"
            onClick={async () => {
              const c = await store.get(m.id);
              if (c) onOpen(c);
            }}
          >
            <span className="history-title">{m.title || 'Untitled'}</span>
            <time title={new Date(m.updatedAt).toLocaleString()}>{relative(m.updatedAt)}</time>
          </button>
          <button
            className="icon-btn sm"
            aria-label={`Delete ${m.title}`}
            title="Delete"
            onClick={async () => {
              await store.remove(m.id);
              await refresh();
            }}
          >
            <IconX size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}
```

Check `tests/e2e/*.spec.ts` for any `getByRole('button', { name: 'Delete' })` — there is none today; the accessible name `Delete <title>` is unchanged.

- [ ] **Step 11: `App.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { chromeKV } from '@/lib/storage/kv';
import { selectModel } from '@/lib/storage/models';
import { ProfileStore } from '@/lib/storage/profiles';
import { SettingsStore } from '@/lib/storage/settings';
import type { Attachment } from '@/lib/types';
import { IconX } from '@/lib/ui/icons';
import { canSend, supportsVisionFor } from '@/lib/ui/models';
import { targetTabId } from '@/lib/ui/targetTab';
import { useModelCatalog } from '@/lib/ui/useModelCatalog';
import { usePanelPort } from '@/lib/ui/usePanelPort';
import { useProfiles } from '@/lib/ui/useProfiles';
import { useTheme } from '@/lib/ui/useTheme';
import { ChatView } from './components/ChatView';
import { Composer } from './components/Composer';
import { GateCard } from './components/GateCard';
import { Header } from './components/Header';
import { HistoryList } from './components/HistoryList';
import { ModelMenu } from './components/ModelMenu';
import { TabChip } from './components/TabChip';

export function App() {
  useTheme();
  const { state, dispatch, send } = usePanelPort();
  const { profiles, active } = useProfiles();
  const { catalog, refreshAll, refreshOne, refreshing } = useModelCatalog(profiles);
  const stores = useMemo(() => ({ profiles: new ProfileStore(chromeKV()), settings: new SettingsStore(chromeKV()) }), []);
  const [view, setView] = useState<'chat' | 'history'>('chat');

  const firstUser = state.turns.find((t) => t.kind === 'user');
  const title = firstUser && firstUser.kind === 'user' ? firstUser.text : 'New chat';

  async function onSend(text: string, attachments: Attachment[]) {
    const tabId = await targetTabId();
    if (tabId === undefined) {
      dispatch({ type: 'error', message: 'There is no tab for the agent to control.' });
      return;
    }
    send({ type: 'start', conversationId: state.conversationId, text, attachments, tabId });
  }

  return (
    <div className="app">
      <Header
        title={title}
        view={view}
        busy={state.running}
        onNew={() => {
          dispatch({ type: 'new_chat' });
          setView('chat');
        }}
        onToggleHistory={() => setView((v) => (v === 'chat' ? 'history' : 'chat'))}
      />
      {view === 'history' ? (
        <HistoryList
          onOpen={(c) => {
            dispatch({ type: 'load', conversationId: c.id, turns: c.turns });
            setView('chat');
          }}
        />
      ) : (
        <>
          <ChatView turns={state.turns} streaming={state.streaming} reasoning={state.reasoning} running={state.running} />
          {state.gates.length > 0 && (
            <div className="gates">
              {state.gates.map((g) => (
                <GateCard key={g.requestId} gate={g} onAnswer={(value) => send({ type: 'gate', requestId: g.requestId, value })} />
              ))}
            </div>
          )}
          {state.error && (
            <div className="error" role="alert">
              <span>{state.error}</span>
              <button className="icon-btn sm" aria-label="Dismiss" onClick={() => dispatch({ type: 'dismiss_error' })}>
                <IconX size={14} />
              </button>
            </div>
          )}
          <TabChip />
          <Composer
            running={state.running}
            ready={canSend(active)}
            vision={active ? supportsVisionFor(active, active.model) : false}
            modelMenu={
              <ModelMenu
                profiles={profiles}
                active={active}
                catalog={catalog}
                refreshing={refreshing}
                disabled={state.running}
                onOpen={() => refreshAll(false)}
                onRefresh={(p) => void refreshOne(p, true)}
                onSelect={(profileId, model) => void selectModel(stores.profiles, stores.settings, profileId, model)}
              />
            }
            onSend={(t, a) => void onSend(t, a)}
            onStop={() => send({ type: 'stop' })}
          />
        </>
      )}
    </div>
  );
}
```

`useProfiles` already reloads on `chrome.storage.onChanged`, so the pill updates after `selectModel` writes.

- [ ] **Step 12: `style.css`**

```css
.app { display: flex; flex-direction: column; height: 100vh; }

.hd { display: flex; align-items: center; gap: 2px; padding: 8px 10px 8px 14px; border-bottom: 1px solid var(--border); }
.hd-title { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--muted); }
.icon-btn:hover:not(:disabled) { background: var(--surface-2); color: var(--fg); }
.icon-btn[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent-text); }
.icon-btn.sm { width: 22px; height: 22px; border-radius: 6px; }

.chat { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.empty { margin: auto 0; text-align: center; padding: 0 16px; }
.empty .logo { width: 44px; height: 44px; margin: 0 auto 12px; border-radius: 14px; display: grid; place-items: center; background: linear-gradient(135deg, #9b82ff, var(--accent)); box-shadow: 0 4px 14px rgba(124, 92, 255, .35); }
.empty h2 { margin: 0; font-size: 15px; }
.empty p { margin: 4px 0 0; color: var(--muted); font-size: 12.5px; }
.empty-note { color: var(--muted); text-align: center; margin-top: 40px; }

.user-msg { align-self: flex-end; max-width: 85%; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.bubble { background: var(--accent); color: var(--accent-fg); padding: 8px 12px; border-radius: 16px 16px 4px 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
.user-atts { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.user-atts img { width: 56px; height: 56px; object-fit: cover; border-radius: 10px; border: 1px solid var(--border); }
.user-file { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; padding: 3px 8px; border-radius: 8px; background: var(--surface-2); color: var(--muted); }

.md { overflow-wrap: anywhere; }
.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md p, .md ul, .md ol { margin: 0 0 8px; }
.md ul, .md ol { padding-left: 20px; }
.md h1, .md h2, .md h3 { margin: 12px 0 6px; line-height: 1.3; }
.md h1 { font-size: 17px; } .md h2 { font-size: 15.5px; } .md h3 { font-size: 14px; }
.md a { color: var(--accent-text); }
.md code { font: 12px var(--mono); background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
.md-pre { position: relative; margin: 0 0 8px; }
.md-pre pre { margin: 0; padding: 10px 12px; background: var(--surface-2); border-radius: 8px; overflow-x: auto; }
.md-pre pre code { background: none; padding: 0; }
.md-copy { position: absolute; top: 6px; right: 6px; border: 0; background: var(--bg); color: var(--muted); border-radius: 6px; width: 24px; height: 24px; display: grid; place-items: center; opacity: 0; transition: opacity 120ms; }
.md-pre:hover .md-copy { opacity: 1; }
.md-table { overflow-x: auto; margin: 0 0 8px; }
.md table { border-collapse: collapse; font-size: 12.5px; }
.md th, .md td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; }
.md th { background: var(--surface); }
.md blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 3px solid var(--border-strong); color: var(--muted); }

.act { border: 1px solid var(--border); background: var(--surface); border-radius: 12px; overflow: hidden; }
.act-head { width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 0; background: transparent; color: var(--muted); font-size: 12.5px; text-align: left; }
.act-head:hover { color: var(--fg); }
.act-title { font-weight: 600; }
.act-time { margin-left: auto; }
.act-fail { display: inline-flex; gap: 3px; align-items: center; color: var(--danger); font-size: 11.5px; }
.act-body { border-top: 1px solid var(--border); padding: 4px 0; }
.act-row { width: 100%; display: flex; gap: 10px; align-items: center; padding: 6px 12px; border: 0; background: transparent; text-align: left; font-size: 12.5px; color: var(--fg); }
.act-row:hover { background: var(--surface-2); }
.act-row.open { background: var(--bg); }
.act-row.think, .act-row.live-row { align-items: flex-start; }
.act-ic { width: 22px; height: 22px; border-radius: 7px; flex: none; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.act-ic.ok { background: var(--ok-bg); color: var(--ok); }
.act-ic.bad { background: var(--danger-bg); color: var(--danger); }
.act-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.act-row.open .act-label { white-space: normal; font-weight: 600; }
.act-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.think-preview { color: var(--muted); font-style: italic; font-size: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
.think-full { color: var(--muted); font-style: italic; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.thumb { width: 38px; height: 24px; object-fit: cover; border-radius: 5px; border: 1px solid var(--border); flex: none; }
.badge { font-size: 10.5px; padding: 0 6px; border-radius: 4px; background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn-border); }
.act-detail { padding: 0 12px 10px 44px; background: var(--bg); }
.shot { width: 100%; border-radius: 8px; border: 1px solid var(--border); display: block; }
.result { margin: 6px 0 0; padding: 6px 8px; font: 11.5px/1.45 var(--mono); background: var(--surface-2); border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 200px; overflow: auto; }

.gates { padding: 0 12px 8px; display: flex; flex-direction: column; gap: 8px; }
.gate { border: 1px solid var(--border-strong); background: var(--bg); border-radius: 12px; padding: 10px 12px; box-shadow: var(--shadow); }
.gate-risky { border-color: var(--warn-border); background: var(--warn-bg); }
.gate-error { border-color: var(--danger); background: var(--danger-bg); }
.gate-title { margin: 0 0 2px; font-weight: 600; display: flex; gap: 6px; align-items: center; }
.gate-risky .gate-title { color: var(--warn); }
.gate-desc { margin: 0 0 4px; }
.gate-reasons { margin: 0 0 4px; padding-left: 18px; color: var(--muted); font-size: 12.5px; }
.gate-why { margin: 0 0 4px; color: var(--muted); font-size: 12px; font-style: italic; }
.gate-input { width: 100%; font: inherit; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--fg); margin: 4px 0 6px; }
.gate-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.btn { padding: 5px 12px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--bg); font-size: 12.5px; }
.btn:hover:not(:disabled) { background: var(--surface-2); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn.primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--accent); }
.btn.ghost { border-color: transparent; background: transparent; }
.btn.danger { color: var(--danger); }

.error { margin: 0 12px 8px; padding: 8px 10px; border-radius: 10px; background: var(--danger-bg); color: var(--danger); display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; }
.error span { flex: 1; }

.tabchip { align-self: flex-start; display: inline-flex; gap: 6px; align-items: center; max-width: calc(100% - 24px); margin: 0 12px 6px; padding: 2px 10px 2px 6px; border-radius: 999px; background: var(--surface-2); color: var(--muted); font-size: 11.5px; }
.tabchip img { width: 14px; height: 14px; border-radius: 3px; }
.tabchip span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.composer { position: relative; margin: 0 12px 12px; padding: 10px 10px 8px 12px; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--bg); box-shadow: var(--shadow); }
.composer:focus-within { border-color: color-mix(in srgb, var(--accent) 45%, var(--border-strong)); }
.composer textarea { width: 100%; border: 0; outline: none; resize: none; background: transparent; color: var(--fg); font: inherit; padding: 2px 0; min-height: 22px; max-height: 200px; }
.composer textarea::placeholder { color: var(--faint); }
.composer-bar { display: flex; align-items: center; gap: 4px; margin-top: 4px; }
.composer-error { color: var(--danger); font-size: 12px; margin-bottom: 6px; }
.round-btn { margin-left: auto; width: 32px; height: 32px; border-radius: 50%; border: 0; display: grid; place-items: center; background: var(--accent); color: var(--accent-fg); }
.round-btn.stop { background: var(--fg); color: var(--bg); }
.dropzone { position: fixed; inset: 8px; z-index: 10; display: grid; place-items: center; border: 2px dashed var(--accent); border-radius: 14px; background: color-mix(in srgb, var(--accent-soft) 85%, transparent); color: var(--accent-text); font-weight: 600; pointer-events: none; }

.tray { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.att-img, .att-file { position: relative; height: 52px; border-radius: 10px; }
.att-img img { width: 52px; height: 52px; object-fit: cover; border-radius: 10px; border: 1px solid var(--border); display: block; }
.att-file { display: flex; gap: 8px; align-items: center; padding: 6px 10px 6px 6px; border: 1px solid var(--border); max-width: 200px; }
.att-badge { width: 32px; height: 38px; flex: none; border-radius: 6px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-text); font: 700 9px var(--font); }
.att-text { display: flex; flex-direction: column; min-width: 0; }
.att-name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.att-meta { font-size: 11px; color: var(--muted); }
.att-x { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--bg); background: var(--fg); color: var(--bg); display: grid; place-items: center; padding: 0; }

.mm { position: relative; }
.pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 0; border-radius: 999px; background: var(--surface-2); color: var(--fg); font-size: 12px; max-width: 200px; }
.pill:hover:not(:disabled), .pill.on { background: var(--accent-soft); color: var(--accent-text); }
.mm-pop { position: absolute; left: -40px; bottom: calc(100% + 10px); width: min(320px, calc(100vw - 24px)); z-index: 20; background: var(--bg); border: 1px solid var(--border-strong); border-radius: 14px; box-shadow: var(--shadow-lg); padding: 6px; display: flex; flex-direction: column; max-height: 60vh; }
.mm-search { font: inherit; font-size: 12.5px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--fg); outline: none; margin-bottom: 4px; }
.mm-list { overflow-y: auto; }
.mm-group { display: flex; justify-content: space-between; align-items: center; padding: 8px 8px 2px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--faint); }
.mm-opt { width: 100%; display: flex; gap: 8px; align-items: center; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent; text-align: left; font-size: 12.5px; color: var(--fg); }
.mm-opt.hot, .mm-opt:hover { background: var(--surface-2); }
.mm-opt.sel { background: var(--accent-soft); }
.mm-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tag { font-size: 10.5px; padding: 0 6px; border-radius: 4px; background: var(--surface-2); color: var(--muted); }
.mm-note { font-size: 11.5px; padding: 2px 8px 6px; display: flex; gap: 4px; align-items: center; }
.mm-note.warn { color: var(--warn); }
.mm-foot { display: flex; gap: 6px; align-items: center; border: 0; border-top: 1px solid var(--border); background: transparent; margin-top: 4px; padding: 8px 8px 4px; color: var(--accent-text); font-size: 12.5px; text-align: left; }

.history { list-style: none; margin: 0; padding: 8px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1; }
.history li { display: flex; gap: 4px; align-items: center; border-radius: 10px; }
.history li:hover { background: var(--surface-2); }
.history-open { flex: 1; min-width: 0; display: flex; flex-direction: column; text-align: left; border: 0; background: transparent; padding: 8px 10px; }
.history-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.history time { color: var(--muted); font-size: 11.5px; }
```

- [ ] **Step 13: Delete the replaced components**

```bash
git rm src/entrypoints/sidepanel/components/StepCard.tsx src/entrypoints/sidepanel/components/ProfilePicker.tsx
```

- [ ] **Step 14: Compile, unit tests, build, e2e**

Run: `npm run compile && npm test && npm run test:e2e`
Expected: compile and unit tests pass. In e2e, every spec passes **except** the last assertion of `sheet.spec.ts` (`getByText('Type "Item⇥…" into textbox')`), which fails because the finished card is collapsed — Task 9 fixes it. Any other failure must be fixed before committing. The header shows the first user message as the chat title; existing e2e assertions only `getByText` assistant replies and gate text, so this does not create duplicate matches. If a strict-mode violation appears anyway, check which two nodes matched and remove the duplicate from the UI rather than loosening the test.

- [ ] **Step 15: Commit**

```bash
git add -A src/entrypoints/sidepanel
git commit -m "feat: rebuild the side panel with activity cards, model menu and new composer"
```

---

### Task 9: Expand finished activity in the sheet e2e test

**Files:**
- Modify: `tests/e2e/sheet.spec.ts:75`

**Interfaces:**
- Consumes: activity header button text `Worked through N steps` (Task 8).

- [ ] **Step 1: Update the assertion**

Replace line 75:

```ts
  await expect(panel.getByText('Type "Item⇥Cost⏎Rent⇥1200⏎Food⇥450⏎Total⇥=SUM(B2:B3)⏎" into textbox')).toBeVisible();
```

with:

```ts
  // The finished task's steps are collapsed into one activity card; one click shows them.
  await panel.getByRole('button', { name: /Worked through \d+ steps/ }).click();
  await expect(panel.getByText('Type "Item⇥Cost⏎Rent⇥1200⏎Food⇥450⏎Total⇥=SUM(B2:B3)⏎" into textbox')).toBeVisible();
```

- [ ] **Step 2: Run the spec**

Run: `npm run build && npx playwright test tests/e2e/sheet.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/sheet.spec.ts
git commit -m "test: expand the finished activity card before checking a step label"
```

---

### Task 10: Settings page refresh (providers, vision models, theme)

**Files:**
- Modify: `src/entrypoints/options/App.tsx`
- Rewrite: `src/entrypoints/options/style.css`
- Modify: `src/entrypoints/options/main.tsx`

**Interfaces:**
- Consumes: `Theme`, `Settings.theme`, `Profile.visionModels` (Task 1); `useTheme` + `theme.css` (Task 7); `ModelCatalog` (Task 4).

- [ ] **Step 1: `main.tsx`** — add `import '@/lib/ui/theme.css';` above `import './style.css';`.

- [ ] **Step 2: `App.tsx` changes**

1. Top of `App()`: call `useTheme();` (import from `@/lib/ui/useTheme`). Heading becomes `<h1>Settings</h1>` with a subtitle `<p className="muted">Browser Control</p>`.
2. `ProfilesSection`: heading `Providers`, button text `Add provider`. Each row shows `p.name`, then `<span className="muted">{p.model || 'no model'}</span>` and small tags for context mode / vision / reasoning effort (`<span className="tag">…</span>`). Wrap Edit/Delete in `.row-actions` with `className="btn"`/`"btn ghost danger"`.
3. `ProfileForm`:
   - After a successful `test()`, also write the list into the catalog so the side panel's menu is warm:
     ```ts
     await new ModelCatalog(chromeKV(), async () => ids).refresh(p, { force: true });
     ```
     (import `ModelCatalog` from `@/lib/storage/models`, `chromeKV` is already imported).
   - Below the "Supports images (vision)" checkbox add the per-model vision picker, shown only when `models.length > 0`:
     ```tsx
     {models.length > 0 && (
       <fieldset className="vision-models">
         <legend>Vision-capable models <span className="muted">(leave all unticked to use the checkbox above for every model)</span></legend>
         {models.map((m) => (
           <label key={m} className="check">
             <input
               type="checkbox"
               checked={(p.visionModels ?? []).includes(m)}
               onChange={(e) =>
                 set('visionModels', e.target.checked ? [...(p.visionModels ?? []), m] : (p.visionModels ?? []).filter((x) => x !== m))
               }
             />
             {m}
           </label>
         ))}
       </fieldset>
     )}
     ```
   - Buttons use `className="btn"` / `"btn primary"`.
4. `GeneralSection`: add theme state and a segmented control above the step limit:
   ```tsx
   const [theme, setTheme] = useState<Theme>('system');
   // in the store.get().then: setTheme(s.theme);
   ```
   ```tsx
   <div className="field">
     <span>Theme</span>
     <div className="seg" role="radiogroup" aria-label="Theme">
       {(['system', 'light', 'dark'] as const).map((t) => (
         <button
           key={t}
           role="radio"
           aria-checked={theme === t}
           className={theme === t ? 'on' : ''}
           onClick={() => {
             setTheme(t);
             void store.update({ theme: t });
           }}
         >
           {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
         </button>
       ))}
     </div>
   </div>
   ```
   Theme saves immediately (no Save press) so the change is visible at once in both pages. Import `Theme` from `@/lib/types`.
   Heading `Agent behaviour` → `General`.
5. `SitesSection`: heading `Always-allowed sites` unchanged; Revoke button gets `className="btn ghost danger"`.

- [ ] **Step 3: `style.css`**

```css
.options { max-width: 720px; margin: 0 auto; padding: 32px 16px 64px; }
.options h1 { margin: 0; font-size: 22px; }
.options > .muted { margin: 2px 0 8px; }
section { border: 1px solid var(--border); background: var(--bg); border-radius: 14px; padding: 18px; margin-top: 16px; box-shadow: var(--shadow); }
h2 { margin: 0 0 12px; font-size: 15px; }
.muted, .status { color: var(--muted); }
.rows { list-style: none; padding: 0; margin: 0 0 12px; }
.rows li { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.rows li:last-child { border-bottom: 0; }
.rows li > span:first-child { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; min-width: 0; }
.row-actions { display: flex; gap: 6px; }
.tag { font-size: 11px; padding: 0 6px; border-radius: 4px; background: var(--surface-2); color: var(--muted); }
.form { display: grid; gap: 12px; margin-top: 14px; padding: 14px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); }
label, .field { display: grid; gap: 4px; font-size: 13px; }
label.check { display: flex; gap: 8px; align-items: center; }
input, select, textarea { font: inherit; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--fg); }
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
fieldset.vision-models { border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; display: grid; gap: 4px; max-height: 200px; overflow-y: auto; }
fieldset.vision-models legend { font-size: 12.5px; padding: 0 4px; }
.actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 4px; }
.actions .status { flex: 1; }
.errors { color: var(--danger); margin: 0; }
.btn { padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--bg); font-size: 13px; }
.btn:hover { background: var(--surface-2); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn.ghost { border-color: transparent; background: transparent; }
.btn.danger { color: var(--danger); }
.seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 10px; background: var(--surface-2); justify-self: start; }
.seg button { border: 0; background: transparent; padding: 5px 14px; border-radius: 8px; font-size: 12.5px; color: var(--muted); }
.seg button.on { background: var(--bg); color: var(--fg); box-shadow: var(--shadow); }
```

Every `<button>` in `App.tsx` that previously relied on the global `button` style gets `className="btn"` (or `btn primary` / `btn ghost danger`).

- [ ] **Step 4: Compile + build**

Run: `npm run compile && npm run build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/options
git commit -m "feat: refreshed settings page with providers, vision models and theme"
```

---

### Task 11: New e2e checks and visual verification

**Files:**
- Create: `tests/e2e/ui.spec.ts`
- Modify: `tests/e2e/servers.ts` (the `/models` response)

**Interfaces:**
- Consumes: everything above; e2e helpers `configure`, `openPanel`, `tabIdFor`, `servers.setScript`, `servers.requests`.

- [ ] **Step 1: Make the mock LLM list two models**

In `tests/e2e/servers.ts`, change the `/models` body to:

```ts
JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'mock-model-2' }] })
```

and record which model each chat request used: `requests` entries already hold the parsed body, which includes `model`. Extend the type: `requests: Array<{ model?: string; messages: unknown[]; tools: unknown[] }>;`.

- [ ] **Step 2: Write `tests/e2e/ui.spec.ts`**

```ts
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
```

Check `prettyModel('mock-model-2')` → `Mock Model 2` (word `2` is capitalised unchanged). The cursor label itself is covered by the driver and overlay unit tests (the overlay's shadow root is closed to page scripts); its look is checked by screenshot in Step 4.

- [ ] **Step 3: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: all specs PASS.

- [ ] **Step 4: Visual check of the real panel in both themes**

Create a throwaway script in the session scratchpad (not committed) that, using the e2e fixtures' launch approach, opens `sidepanel.html` at 400×800 and `options.html`, sets `settings.theme` to `'light'` then `'dark'` via `chrome.storage.local`, and screenshots each. Simplest path: add a temporary `test.only` in `ui.spec.ts` that does:

```ts
for (const theme of ['light', 'dark'] as const) {
  await sw.evaluate(async (t) => {
    const s = (await chrome.storage.local.get('settings')).settings;
    await chrome.storage.local.set({ settings: { ...s, theme: t } });
  }, theme);
  await panel.waitForTimeout(200);
  await panel.screenshot({ path: `test-results/panel-${theme}.png` });
}
```

run it after the markdown test's final assertion. For the cursor, add to the same temporary block a scripted task on `form.html` — `hover {id:1}` then `ask_user {question:'ok?'}` — and while it waits on the question take `page.screenshot({ path: 'test-results/cursor-label.png' })`. Look at `test-results/panel-light.png`, `panel-dark.png` and `cursor-label.png`, fix any visual defects (overflow at 400px, unreadable contrast in dark, label clipping), then remove the `test.only` block before committing.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/ui.spec.ts tests/e2e/servers.ts
git commit -m "test: e2e checks for markdown, activity card and model menu"
```

---

### Task 12: Final verification

- [ ] **Step 1: Full gates**

Run: `npm run compile && npm test && npm run test:e2e`
Expected: all pass, output captured in the final report.

- [ ] **Step 2: README touch-up**

In `README.md` "Using it": replace "optionally attach images, PDFs or text files, press **Send**" with "optionally attach images, PDFs or text files (paperclip, drag-drop or paste), pick a model from the menu in the input box, press **Send**". Replace "Open the panel's ⚙ (Settings)" with "Open Settings (gear icon in the panel header)". Add under Using it: "- Theme: System / Light / Dark in Settings → General."

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe the model menu, attachments and theme"
```
