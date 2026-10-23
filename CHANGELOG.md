# Changelog

## Unreleased

- The Errand tab group is created when you open the panel, not when you send a prompt, so you can add tabs to it first. Tabs you add or close are picked up live, a stopped task resumes in the same group, and a new group is made only for a new chat. The strip above the message box now shows the group and its tab count.
- "Auto-approve" is now per site instead of per tab: the checkbox above the message box applies to the page you're on, is saved (and listed in Settings), and unchecking it removes the site. It no longer follows a tab to whatever site the agent navigates to.
- The on-page cursor pill now says only what kind of element is being used (e.g. "Clicking a button"), without field names or typed text, and stays sharp while moving. Step descriptions are in plain English (`Click the "Save" button`) with no HTML jargon or coordinates. The cursor is larger with a glow, and the page edge has a soft glow instead of a thin line.

## 1.0.0 — 2026-10-05

First public release, as **Errand** (previously the private "Browser Control" project).

- Side-panel browsing agent for any OpenAI-compatible model, hosted or local.
- Live on-page cursor, element highlights and a step-by-step activity log.
- Approvals before new sites and risky actions; Stop ends a task immediately.
- Works across multiple tabs in a dedicated "Errand" tab group.
- Image, PDF and text attachments; local chat history; light and dark themes.
- Provider presets for OpenAI, OpenRouter, Ollama, LM Studio and OpenCode Go, and a "Connect a model" first-run screen.
- New logo and icons.
