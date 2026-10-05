import { expect, it } from 'vitest';
import { OpenAIClient } from '@/lib/llm/client';
import { TOOL_SCHEMAS } from '@/lib/agent/tools';
import { systemPrompt } from '@/lib/agent/prompts';

it.skipIf(!process.env.OPEN_CODE_GO_API_KEY)('OpenCode Go returns a tool call through the real client', async () => {
  const client = new OpenAIClient({ baseUrl: 'https://opencode.ai/zen/go/v1', apiKey: process.env.OPEN_CODE_GO_API_KEY!, model: 'glm-5.3-flash' }, { retryDelaysMs: [] });
  const r = await client.chat({
    sessionId: crypto.randomUUID(),
    tools: TOOL_SCHEMAS,
    messages: [
      { role: 'system', content: systemPrompt('full', 30) },
      { role: 'user', content: 'Add the red socks to the cart.' },
      { role: 'user', content: 'Page state:\n<page_content untrusted="true">\nURL: https://shop.test/\nTitle: Shop\nElements:\n[1] link "Home"\n[2] button "Add red socks to cart"\n</page_content>' },
    ],
  });
  expect(r.toolCalls[0]?.name).toBe('click');
  expect(r.toolCalls[0]?.args.id).toBe(2);
}, 120_000);
