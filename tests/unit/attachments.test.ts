import { describe, expect, it, vi } from 'vitest';
import { uploadsFromTurns, formatBytes, MAX_IMAGE_BYTES, readAttachment } from '@/lib/attachments';
import type { Turn } from '@/lib/types';

describe('readAttachment', () => {
  it('reads images as data URLs with their size', async () => {
    const a = await readAttachment(new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }));
    expect(a).toEqual({ name: 'shot.png', kind: 'image', dataUrl: 'data:image/png;base64,AQID', meta: '3 B' });
  });

  it('reads text and code files by type or extension, keeping the bytes for uploads', async () => {
    expect(await readAttachment(new File(['hello'], 'notes.txt', { type: 'text/plain' }))).toEqual({
      name: 'notes.txt', kind: 'text', text: 'hello', dataUrl: 'data:text/plain;base64,aGVsbG8=', meta: '5 B',
    });
    expect((await readAttachment(new File(['x = 1'], 'a.py', { type: '' }))).text).toBe('x = 1');
    expect((await readAttachment(new File(['{}'], 'a.json', { type: 'application/json' }))).kind).toBe('text');
  });

  it('routes PDFs to the PDF extractor and reports pages', async () => {
    const pdfToText = vi.fn(async () => ({ text: '--- Page 1 ---\nHi', pages: 1 }));
    const a = await readAttachment(new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }), { pdfToText });
    expect(a).toEqual({ name: 'doc.pdf', kind: 'text', text: '--- Page 1 ---\nHi', dataUrl: 'data:application/pdf;base64,JVBERg==', meta: '1 page' });
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

describe('uploadsFromTurns', () => {
  it('collects every attachment with original bytes across all user turns', () => {
    const turns: Turn[] = [
      { kind: 'user', text: 'file these', attachments: [
        { name: 'receipt.pdf', kind: 'text', text: 'pages', dataUrl: 'data:application/pdf;base64,JVBERi0=' },
      ] },
      { kind: 'assistant', text: 'ok' },
      { kind: 'user', text: 'this one too', attachments: [
        { name: 'scan.png', kind: 'image', dataUrl: 'data:image/png;base64,AQID', meta: '3 B' },
      ] },
    ];
    expect(uploadsFromTurns(turns)).toEqual([
      { name: 'receipt.pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' },
      { name: 'scan.png', dataUrl: 'data:image/png;base64,AQID' },
    ]);
  });

  it('skips turn kinds without files and attachments without bytes', () => {
    const turns: Turn[] = [
      { kind: 'user', text: 'no files', attachments: [] },
      { kind: 'step', id: 's', label: '', reasoning: '', call: { id: 'c', name: 'click', args: {} }, result: '', risky: false },
    ];
    expect(uploadsFromTurns(turns)).toEqual([]);
  });
});
