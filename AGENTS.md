# AGENTS.md

Errand is a Chrome MV3 side-panel browsing agent (WXT + React + TypeScript). Bring-your-own OpenAI-compatible model.

## Layout

- `src/entrypoints/` — `background.ts` (service worker), `content.ts`, `sidepanel/` and `options/` React apps.
- `src/lib/agent/` — the agent loop (`loop.ts`), tools, prompts, context building.
- `src/lib/llm/` — model client and wire protocols (Chat Completions, Responses, Messages), streaming, tool-call parsing.
- `src/lib/browser/` — tab group workspace (`tabs.ts`), CDP, driver.
- `src/lib/policy/` — site permissions and risky-action classification. `src/lib/storage/` — settings, profiles, history, site stores.
- `tests/unit` (vitest), `tests/e2e` (Playwright against the built extension), `tests/live*` (needs real API keys, not run in CI).

## Checks (run before every commit)

```sh
npm run compile && npm test && npm run build
```

`npm run test:e2e` for anything touching the side panel, tabs, or content scripts.

## Conventions

- Small diffs, no new dependencies without a reason. Reuse what is in `src/lib` before writing new helpers.
- Chrome APIs are injected behind small interfaces (`TabsApi`, `KV`, ports) so logic stays unit-testable. Keep it that way; add a unit test for new logic.
- User-facing changes get a plain-English line under `## Unreleased` in `CHANGELOG.md`.
- One branch and one PR per feature (`feat/…`, `fix/…`, `docs/…`). Never push to `main`.

## Model routing (multi-agent work)

The orchestrator (Claude) plans, writes briefs and makes final calls. It does not do the bulk implementation. Goal: spend as few Claude tokens as possible without lowering quality.

| Work | Delegate to |
| --- | --- |
| Involved features: multi-file, agent loop, LLM protocols, Chrome API edge cases | **GPT 6.1 Sol, high** (Codex) |
| Small features, refactors, single-area fixes | **GPT 6.1 Sol, medium** (Codex) |
| Code review of every delegate PR; small isolated features | **Gemini** (Antigravity, Gemini 3.8 Flash) |
| Read-only research, codebase sweeps, log/trace triage, docs, trivial edits | **DeepSeek V4.1 Flash** (OpenCode Go) |
| Design decisions, UX options, writing briefs, final verification | Claude (orchestrator) |

Rules:

- Each implementer works in its own worktree and opens its own PR.
- Every implementation PR gets a Gemini review before merge; the orchestrator fixes small findings itself rather than starting another delegate.
- Briefs are self-contained: goal, files to read, constraints, acceptance checks. Delegates get no chat history.
- Escalate a delegate's task one tier (Flash → Sol medium → Sol high) only after a failed attempt, not preemptively.
