import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Errand — AI browser agent',
    short_name: 'Errand',
    description: 'An AI agent that browses for you in a side panel. Bring any OpenAI-compatible model: OpenAI, OpenRouter, Ollama and more.',
    minimum_chrome_version: '118',
    permissions: ['sidePanel', 'storage', 'unlimitedStorage', 'debugger', 'tabs', 'tabGroups', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Open Errand' },
  },
});
