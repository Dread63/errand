import { describe, expect, it } from 'vitest';
import { buildMessages, contextBudget } from '@/lib/agent/context';
import { estimateTokens } from '@/lib/agent/tokens';
import type { ChatMessage } from '@/lib/llm/types';
import type { ObservationRecord, Profile, Turn } from '@/lib/types';

const profile = (over: Partial<Profile> = {}): Profile => ({
  id: 'p',
  name: 'p',
  baseUrl: 'http://x/v1',
  apiKey: '',
  model: 'm',
  supportsVision: false,
  contextMode: 'standard',
  contextWindow: 200_000,
  maxScreenshots: 3,
  ...over,
});
const obs = (n: number, shot = false): ObservationRecord => ({
  url: `https://s.test/${n}`,
  title: `Page ${n}`,
  summary: `SUMMARY-${n}`,
  detail: `DETAIL-${n}`,
  tabs: '* 0: t — u',
  ...(shot ? { screenshot: `data:image/jpeg;base64,${n}` } : {}),
});
const step = (n: number, shot = false): Turn => ({
  kind: 'step',
  id: `s${n}`,
  label: 'Click',
  reasoning: `why ${n}`,
  call: { id: `c${n}`, name: 'click', args: { id: n } },
  result: `RESULT-${n}`,
  risky: false,
  observation: obs(n, shot),
});
const user: Turn = { kind: 'user', text: 'Buy socks', attachments: [] };
const text = (m: ChatMessage[]) => JSON.stringify(m);
const imageCount = (m: ChatMessage[]) => (text(m).match(/"type":"image_url"/g) ?? []).length;

describe('buildMessages', () => {
  it('orders system, user, observation, assistant tool call, tool result, current observation', () => {
    const m = buildMessages({ profile: profile(), stepLimit: 30, turns: [user, step(1)], current: obs(2) });
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'user', 'assistant', 'tool', 'user']);
    const a = m[3] as Extract<ChatMessage, { role: 'assistant' }>;
    expect(a.tool_calls?.[0]).toEqual({ id: 'c1', type: 'function', function: { name: 'click', arguments: '{"id":1}' } });
    expect(m[4]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'RESULT-1' });
    expect(text(m.slice(-1))).toContain('<page_content untrusted=\\"true\\">');
  });

  it('compact: only the current observation is detailed', () => {
    const m = buildMessages({ profile: profile({ contextMode: 'compact' }), stepLimit: 30, turns: [user, step(1), step(2)], current: obs(3) });
    const t = text(m);
    expect(t).toContain('SUMMARY-1');
    expect(t).toContain('SUMMARY-2');
    expect(t).toContain('DETAIL-3');
    expect(t).not.toContain('DETAIL-1');
  });

  it('standard: the last 2 prior observations are detailed', () => {
    const t = text(
      buildMessages({ profile: profile(), stepLimit: 30, turns: [user, step(1), step(2), step(3)], current: obs(4) }),
    );
    expect(t).toContain('SUMMARY-1');
    expect(t).toContain('DETAIL-2');
    expect(t).toContain('DETAIL-3');
  });

  it('full: all prior observations are detailed', () => {
    const t = text(
      buildMessages({ profile: profile({ contextMode: 'full' }), stepLimit: 30, turns: [user, step(1), step(2), step(3)], current: obs(4) }),
    );
    expect(t).toContain('DETAIL-1');
  });

  it('sends no images without vision', () => {
    const turns: Turn[] = [{ kind: 'user', text: 'see', attachments: [{ name: 'a.png', kind: 'image', dataUrl: 'data:image/png;base64,A' }] }, step(1, true)];
    expect(imageCount(buildMessages({ profile: profile(), stepLimit: 30, turns, current: obs(2, true) }))).toBe(0);
  });

  it('vision compact/standard: only the latest screenshot; full: up to maxScreenshots', () => {
    const turns: Turn[] = [user, step(1, true), step(2, true), step(3, true)];
    expect(imageCount(buildMessages({ profile: profile({ supportsVision: true }), stepLimit: 30, turns, current: obs(4, true) }))).toBe(1);
    expect(
      imageCount(buildMessages({ profile: profile({ supportsVision: true, contextMode: 'full', maxScreenshots: 3 }), stepLimit: 30, turns, current: obs(4, true) })),
    ).toBe(3);
  });

  it('includes image attachments with vision and clips text attachments per mode', () => {
    const long = 'z'.repeat(30_000);
    const turns: Turn[] = [
      { kind: 'user', text: 'read', attachments: [{ name: 'a.png', kind: 'image', dataUrl: 'data:image/png;base64,A' }, { name: 'n.txt', kind: 'text', text: long }] },
    ];
    const compact = buildMessages({ profile: profile({ contextMode: 'compact', supportsVision: true }), stepLimit: 30, turns, current: null });
    expect(imageCount(compact)).toBe(1);
    expect(text(compact)).toContain('<attachment name=\\"n.txt\\">');
    expect(text(compact)).toContain('[+10000 chars]');
    const standard = buildMessages({ profile: profile({ supportsVision: true }), stepLimit: 30, turns, current: null });
    expect(text(standard)).not.toContain('[+');
  });

  it('trims oldest material first to fit a small context window', () => {
    const big = (n: number): Turn => ({ ...(step(n) as Extract<Turn, { kind: 'step' }>), observation: { ...obs(n), detail: `DETAIL-${n} ${'d'.repeat(8000)}` }, result: `RESULT-${n} ${'r'.repeat(4000)}` });
    const p = profile({ contextMode: 'full', contextWindow: 16_000 });
    const turns: Turn[] = [user, big(1), big(2), big(3), big(4), big(5), big(6)];
    const m = buildMessages({ profile: p, stepLimit: 30, turns, current: obs(7) });
    expect(estimateTokens(m)).toBeLessThanOrEqual(contextBudget(p));
    const t = text(m);
    expect(t).toContain('Buy socks');
    expect(t).toContain('DETAIL-6');
    expect(t).not.toContain('DETAIL-1 ');
  });

  it('applies calibration from real usage', () => {
    const p = profile({ contextMode: 'full', contextWindow: 16_000 });
    const turns: Turn[] = [user, step(1), step(2)];
    const plain = text(buildMessages({ profile: p, stepLimit: 30, turns, current: obs(3) }));
    const inflated = text(buildMessages({ profile: p, stepLimit: 30, turns, current: obs(3), calibration: 1000 }));
    expect(plain).toContain('DETAIL-1');
    expect(inflated).not.toContain('DETAIL-1');
  });
});
