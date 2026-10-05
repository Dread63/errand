import { installContentAgent } from '@/lib/content/agent';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    installContentAgent();
  },
});
