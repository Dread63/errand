import { describe, expect, it, vi } from 'vitest';
import { formatBytes, MAX_IMAGE_BYTES, readAttachment } from '@/lib/attachments';

describe('readAttachment', () => {
  it('reads images as data URLs with their size', async () => {
    const a = await readAttachment(new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }));
    expect(a).toEqual({ name: 'shot.png', kind: 'image', dataUrl: 'data:image/png;base64,AQID', meta: '3 B' });
  });

  it('reads text and code files by type or extension', async () => {
    expect(await readAttachment(new File(['hello'], 'notes.txt', { type: 'text/plain' }))).toEqual({ name: 'notes.txt', kind: 'text', text: 'hello', meta: '5 B' });
    expect((await readAttachment(new File(['x = 1'], 'a.py', { type: '' }))).text).toBe('x = 1');
    expect((await readAttachment(new File(['{}'], 'a.json', { type: 'application/json' }))).kind).toBe('text');
  });

  it('routes PDFs to the PDF extractor and reports pages', async () => {
    const pdfToText = vi.fn(async () => ({ text: '--- Page 1 ---\nHi', pages: 1 }));
    const a = await readAttachment(new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }), { pdfToText });
    expect(a).toEqual({ name: 'doc.pdf', kind: 'text', text: '--- Page 1 ---\nHi', meta: '1 page' });
    const b = await readAttachment(new File(['%PDF'], 'b.pdf', { type: 'application/pdf' }), { pdfToText: async () => ({ text: '', pages: 4 }) });
    expect(b.meta).toBe('4 pages');
  });

  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(12 * 1024)).toBe('12 KB');
    expect(formatBytes(3.2 * 1024 * 1024)).toBe('3.2 MB');
  });

  it('rejects oversized images and unsupported types', async () => {
    const big = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' });
    await expect(readAttachment(big)).rejects.toThrow('"big.jpg" is larger than 10 MB.');
    await expect(readAttachment(new File(['x'], 'a.bin', { type: 'application/octet-stream' }))).rejects.toThrow(/Unsupported file type/);
  });
});
