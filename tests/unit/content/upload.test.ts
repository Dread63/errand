// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { ElementRegistry } from '@/lib/content/snapshot';
import { attachFiles } from '@/lib/content/upload';

const PERIODIC = 'data:application/pdf;base64,JVBERi0=';

function doc(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

/** Watches which events reach which element and what files end up on the file input. */
function watch(input: HTMLInputElement): { events: string[] } {
  const events: string[] = [];
  input.addEventListener('input', () => events.push('input'));
  input.addEventListener('change', () => events.push('change'));
  return { events };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('attachFiles', () => {
  it('sets the given file on the page file input and fires input and change', () => {
    const d = doc('<input type="file" aria-label="Receipts">');
    const input = d.querySelector('input')!;
    const { events } = watch(input);
    const r = attachFiles(d, new ElementRegistry(), { files: [{ name: 'receipt.pdf', dataUrl: PERIODIC }] });
    expect(input.files).toHaveLength(1);
    expect(input.files![0].name).toBe('receipt.pdf');
    expect(input.files![0].type).toBe('application/pdf');
    expect(events).toEqual(['input', 'change']);
    expect(r).toContain('"receipt.pdf"');
    expect(r).toContain('"Receipts"');
  });

  it('decodes base64 payload bytes exactly', async () => {
    const d = doc('<input type="file">');
    attachFiles(d, new ElementRegistry(), { files: [{ name: 'a.png', dataUrl: 'data:image/png;base64,AQIDBA==' }] });
    const f = d.querySelector('input')!.files![0];
    expect([...new Uint8Array(await f.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect(f.type).toBe('image/png');
  });

  it('clears a previous selection so retries are clean', () => {
    const d = doc('<input type="file">');
    const input = d.querySelector('input')!;
    const dt = new DataTransfer();
    dt.items.add(new File(['old'], 'old.txt'));
    input.files = dt.files;
    attachFiles(d, new ElementRegistry(), { files: [{ name: 'new.pdf', dataUrl: PERIODIC }] });
    expect(input.files![0].name).toBe('new.pdf');
  });

  it('uses the input behind the given id', () => {
    const d = doc('<input type="file" aria-label="Upload">');
    const reg = new ElementRegistry();
    const id = reg.idFor(d.querySelector('input')!);
    attachFiles(d, reg, { files: [{ name: 'r.pdf', dataUrl: PERIODIC }], id });
    expect(d.querySelector('input')!.files![0].name).toBe('r.pdf');
  });

  it('finds the input near a trigger element passed by id (the styled upload button)', () => {
    const d = doc('<form><button>Attach receipt</button><input type="file" name="receipt"></form>');
    const reg = new ElementRegistry();
    const id = reg.idFor(d.querySelector('button')!);
    attachFiles(d, reg, { files: [{ name: 'receipt.pdf', dataUrl: PERIODIC }], id });
    expect(d.querySelector('input')!.files![0].name).toBe('receipt.pdf');
  });

  it('walks up from the trigger element to a shared ancestor when they are siblings', () => {
    const d = doc('<form><div><button>Attach</button></div><div><input type="file"></div></form>');
    const reg = new ElementRegistry();
    const id = reg.idFor(d.querySelector('button')!);
    attachFiles(d, reg, { files: [{ name: 'x.pdf', dataUrl: PERIODIC }], id });
    expect(d.querySelector('input')!.files![0].name).toBe('x.pdf');
  });

  it('skips inputs with an accept attribute that rejects the file, matching extensions', () => {
    const d = doc('<input type="file" accept=".png,image/*" aria-label="Logo"><input type="file" accept=".pdf" aria-label="Receipts">');
    attachFiles(d, new ElementRegistry(), { files: [{ name: 'receipt.pdf', dataUrl: PERIODIC }] });
    expect(d.querySelectorAll('input')[1].files).toHaveLength(1);
    expect(d.querySelectorAll('input')[0].files).toHaveLength(0);
  });

  it('disambiguates several inputs by matching the file name against the label', () => {
    const d = doc('<input type="file" aria-label="Logo"><input type="file" aria-label="Receipts">');
    attachFiles(d, new ElementRegistry(), { files: [{ name: 'receipt.pdf', dataUrl: PERIODIC }] });
    expect(d.querySelectorAll('input')[1].files).toHaveLength(1);
  });

  it('reports a stale id with the model-readable error the other tools use', () => {
    const d = doc('<input type="file">');
    expect(() => attachFiles(d, new ElementRegistry(), { files: [{ name: 'r.pdf', dataUrl: PERIODIC }], id: 99 })).toThrow(
      'Element [99] no longer exists on the page. Use an id from the latest page state.',
    );
  });

  it('refuses to guess when several inputs match and no label helps', () => {
    const d = doc('<input type="file" aria-label="Docs"><input type="file" aria-label="Files">');
    expect(() => attachFiles(d, new ElementRegistry(), { files: [{ name: 'r.pdf', dataUrl: PERIODIC }] })).toThrow(
      /Several file inputs on this page accept this file: "Docs", "Files"/,
    );
  });

  it('refuses to hand several files to an input without the multiple attribute', () => {
    const d = doc('<input type="file" accept=".pdf">');
    expect(() => attachFiles(d, new ElementRegistry(), { files: [
      { name: 'a.pdf', dataUrl: PERIODIC },
      { name: 'b.pdf', dataUrl: PERIODIC },
    ] })).toThrow(/Call attach_files once per file/);
  });

  it('gives several files together to an input that has multiple', () => {
    const d = doc('<input type="file" multiple>');
    const input = d.querySelector('input')!;
    attachFiles(d, new ElementRegistry(), { files: [
      { name: 'a.pdf', dataUrl: PERIODIC },
      { name: 'b.pdf', dataUrl: PERIODIC },
    ] });
    expect(input.files!.length).toBe(2);
  });

  it('explains that the files cannot be attached without a file input on the page', () => {
    const d = doc('<div>no uploads here</div>');
    expect(() => attachFiles(d, new ElementRegistry(), { files: [{ name: 'r.pdf', dataUrl: PERIODIC }] })).toThrow(
      /There is no file input/,
    );
  });

  it('hides disabled inputs from the pool and says the page controls accept nothing usable', () => {
    const d = doc('<input type="file" disabled>');
    expect(() => attachFiles(d, new ElementRegistry(), { files: [{ name: 'r.pdf', dataUrl: PERIODIC }] })).toThrow(
      /no file input|accepts nothing/,
    );
  });

  it('reports when no nearby input accepts the file, listing accept attributes', () => {
    const d = doc('<form><button>Attach</button><input type="file" accept=".png" aria-label="Logo"></form>');
    const reg = new ElementRegistry();
    const id = reg.idFor(d.querySelector('button')!);
    expect(() => attachFiles(d, reg, { files: [{ name: 'receipt.pdf', dataUrl: PERIODIC }], id })).toThrow(
      /\(accepts \.png\)/,
    );
  });
});
