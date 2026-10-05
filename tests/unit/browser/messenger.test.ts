import { describe, expect, it, vi } from 'vitest';
import { ContentMessenger } from '@/lib/browser/messenger';
import { ToolError } from '@/lib/errors';

describe('ContentMessenger', () => {
  it('wraps requests and unwraps values', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true as const, value: 'pong' }));
    const m = new ContentMessenger({ sendMessage, inject: vi.fn() });
    expect(await m.send(3, { type: 'ping' })).toBe('pong');
    expect(sendMessage).toHaveBeenCalledWith(3, { __bc: true, req: { type: 'ping' } });
  });

  it('injects and retries once when the page has no listener', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('Receiving end does not exist'))
      .mockResolvedValueOnce({ ok: true, value: 1 });
    const inject = vi.fn(async () => {});
    expect(await new ContentMessenger({ sendMessage, inject }).send(3, { type: 'ping' })).toBe(1);
    expect(inject).toHaveBeenCalledWith(3);
  });

  it('turns page errors and repeated failures into ToolError', async () => {
    const m = new ContentMessenger({ sendMessage: async () => ({ ok: false, error: 'No option "XL"' }), inject: async () => {} });
    await expect(m.send(1, { type: 'ping' })).rejects.toThrow(new ToolError('No option "XL"'));
    const dead = new ContentMessenger({ sendMessage: async () => Promise.reject(new Error('gone')), inject: async () => {} });
    await expect(dead.send(1, { type: 'ping' })).rejects.toThrow(/Could not reach the page/);
  });

  it('ensureInjected injects only when ping fails', async () => {
    const inject = vi.fn(async () => {});
    await new ContentMessenger({ sendMessage: async () => ({ ok: true, value: 'pong' }), inject }).ensureInjected(1);
    expect(inject).not.toHaveBeenCalled();
    await new ContentMessenger({ sendMessage: async () => Promise.reject(new Error('x')), inject }).ensureInjected(1);
    expect(inject).toHaveBeenCalledTimes(1);
  });
});
