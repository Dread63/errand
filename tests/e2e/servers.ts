import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

export interface ScriptedCall {
  name: string;
  arguments: Record<string, unknown>;
  content?: string;
  /** Further tool calls returned in the same model reply. */
  also?: ScriptedCall[];
}

export interface Servers {
  siteUrl: string;
  llmUrl: string;
  setScript(calls: ScriptedCall[]): void;
  requests: Array<{ model?: string; messages: unknown[]; tools: unknown[] }>;
  close(): Promise<void>;
}

export async function startServers(): Promise<Servers> {
  const pagesDir = path.resolve('tests/e2e/pages');
  const site = http.createServer(async (req, res) => {
    const name = path.basename((req.url ?? '/').split('?')[0]) || 'form.html';
    let body: Buffer;
    try {
      body = await fs.readFile(path.join(pagesDir, name));
    } catch {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(body);
  });

  let script: ScriptedCall[] = [];
  const requests: Servers['requests'] = [];
  const llm = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url?.endsWith('/chat/completions')) {
        requests.push(JSON.parse(raw));
        const next = script.shift() ?? { name: 'done', arguments: { summary: 'Script exhausted' } };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        if (next.content) send({ choices: [{ delta: { content: next.content } }] });
        send({
          choices: [
            {
              delta: {
                tool_calls: [next, ...(next.also ?? [])].map((c, index) => ({
                  index,
                  id: `call_${requests.length}_${index}`,
                  type: 'function',
                  function: { name: c.name, arguments: JSON.stringify(c.arguments) },
                })),
              },
            },
          ],
        });
        res.end('data: [DONE]\n\n');
      } else if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'mock-model-2' }] }));
      } else {
        res.writeHead(404).end();
      }
    });
  });

  const listen = (s: http.Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  await Promise.all([listen(site), listen(llm)]);
  const port = (s: http.Server) => (s.address() as AddressInfo).port;
  return {
    siteUrl: `http://127.0.0.1:${port(site)}`,
    llmUrl: `http://127.0.0.1:${port(llm)}/v1`,
    setScript: (calls) => {
      script = [...calls];
      requests.length = 0;
    },
    requests,
    close: async () => {
      await new Promise((r) => site.close(r));
      await new Promise((r) => llm.close(r));
    },
  };
}
