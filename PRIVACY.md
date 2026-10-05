# Errand privacy policy

_Last updated: 5 October 2026_

Errand is a browser extension that carries out web tasks you ask for, using a language model **you** configure. This policy explains what data Errand handles and where it goes.

## The short version

- Errand has **no servers, no accounts, no analytics and no telemetry**. The developer never receives your data.
- Your settings, API keys and chat history stay **on your device**.
- While a task runs, Errand sends what the model needs to see **only to the model provider you configured**, and nowhere else.

## What is stored on your device

Errand uses the browser's extension storage (`chrome.storage.local`) on your device for:

- **Provider settings**: base URLs, model names and API keys you enter.
- **Preferences**: theme, step limit, words that require approval, and sites you chose to "Always allow".
- **Chat history**: your messages, the agent's replies and steps, and files you attached. Screenshots taken during a task are not saved to history.

You can delete individual chats under History, remove providers and sites in Settings, or remove everything by uninstalling Errand.

## What is sent, and to whom

When you start a task, Errand sends the following to the model endpoint configured in your active provider (for example OpenAI, OpenRouter, or a model running on your own computer with Ollama or LM Studio):

- your message and any files you attached;
- text and structure from the pages the agent works on (a simplified snapshot of the page's elements);
- screenshots of those pages, if your model supports images;
- the results of the agent's previous steps in the same task.

That provider's own privacy policy governs what happens to the data after it receives it. If you use a model on your own machine, the data never leaves your computer.

Errand's page script is loaded on every site so it's ready when a task needs it, but it stays idle until then: it reads a page only when the agent is working in that tab, inside the **Errand** tab group, during a task you started. Errand asks for your approval before working on a site you haven't allowed.

## What Errand does not do

- It does not sell your data or share it with third parties, other than sending it to the model provider you chose.
- It does not use or transfer your data for advertising, or for any purpose unrelated to carrying out your tasks.
- It does not use or transfer your data to determine creditworthiness or for lending purposes.
- It does not load or run remote code.

## Permissions

Errand's browser permissions (`debugger`, access to all sites, `scripting`, `tabs`, `tabGroups`, `sidePanel`, `storage`, `unlimitedStorage`) are used only to carry out tasks you request. See the [README](README.md#permissions) for what each one is for.

## Changes and contact

Changes to this policy are published in this file, and the date above is updated. Questions? Open an issue at <https://github.com/Dread63/errand/issues>.
