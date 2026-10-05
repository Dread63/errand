import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Browser Control',
    description: 'Side-panel browsing agent for OpenAI-compatible models',
    minimum_chrome_version: '118',
    permissions: ['sidePanel', 'storage', 'unlimitedStorage', 'debugger', 'tabs', 'tabGroups', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Open Browser Control' },
  },
});
