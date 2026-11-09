# Changelog

## Unreleased

## 1.2.0 — 2026-11-09

- Each task starts in Ask. Auto and Hands-off can be chosen for that task only and are not saved. Auto skips routine steps such as downloads. Passwords, payment fields, and one-time codes always ask, whether the agent types or presses keys, including paste. Tab, Escape, and arrow keys in those fields do not. Enter asks when the label contains a risky word, including a text field such as Send a message, Control+Enter, and typing that presses Enter. Clicking or typing in that text field without Enter does not. On a control that is not a text field, a click, typing on it, Enter, or Space asks, including a div, span, or menu option. Submit and payment are risky words, so a Submit button asks. Enter in a search box does not ask unless it is inside a form or its label has a risky word. Enter inside a form always asks. Typing into a text field such as an order number, without pressing Enter, does not ask. If Tab inside one type action moves onto a button, a password, a different form field, or a text field with a risky word, Errand does not type the rest or press Enter. A frame the page cannot read, such as a card field, also asks. "Allow for the rest of this task" is offered only on routine prompts, lasts until the task ends, and is not saved. Hands-off also opens new sites for that task and ends with one sentence, including when the task is rejected or stopped. The per-site auto-approve list is gone.
- The side panel is available only in Errand tab groups; clicking the toolbar icon adds the current tab to the group and opens the panel.
- Healthy tasks can keep running; after repeated errors or actions on an unchanged page, Errand asks whether to continue.

## 1.1.0 — 2026-10-23

- The Errand tab group is created when you open the panel, not when you send a prompt, so you can add tabs to it first. Tabs you add or close are picked up live, a stopped task resumes in the same group, and a new group is made only for a new chat. The strip above the message box now shows the group and its tab count.
- "Auto-approve" is per site: the checkbox above the message box applies to the page you're on and is saved. Version 1.2.0 replaces that checkbox with a per-task approval mode.
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
