import type { UploadFile } from '../types';
import { collectFileInputs, type ElementRegistry } from './snapshot';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const quoted = (s: string) => (s ? `"${s}"` : '<unnamed>');

function decode(dataUrl: string): Uint8Array<ArrayBuffer> {
  const comma = dataUrl.indexOf(',');
  const bin = atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function mimeOf(dataUrl: string): string {
  return /^data:([^;,]*)/.exec(dataUrl)?.[1] ?? '';
}

interface InputDescription {
  label: string;
  accept: string;
}

function describeInput(input: HTMLInputElement): InputDescription & { input: HTMLInputElement } {
  return { input, label: labelOf(input), accept: input.getAttribute('accept') ?? '' };
}

function describeInputs(inputs: HTMLInputElement[]): string {
  return inputs.map((i) => { const d = describeInput(i); return `${quoted(d.label)}${d.accept ? ` (accepts ${d.accept})` : ''}`; }).join(', ');
}

function labelOf(input: HTMLInputElement): string {
  const aria = input.getAttribute('aria-label');
  if (aria?.trim()) return norm(aria);
  if (input.id) {
    const byFor = input.ownerDocument.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (byFor) return norm(byFor.textContent ?? '');
  }
  const wrap = input.closest('label');
  if (wrap) return norm(wrap.textContent ?? '');
  return norm(input.getAttribute('name') ?? input.id ?? '');
}

/** Whether every file is allowed by the input's accept attribute (which often uses extensions). */
function accepts(input: HTMLInputElement, files: File[]): boolean {
  const spec = (input.getAttribute('accept') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!spec.length) return true;
  return files.every((f) => {
    const name = f.name.toLowerCase();
    const mime = f.type.toLowerCase();
    return spec.some((s) =>
      s.startsWith('.') ? name.endsWith(s) : s.endsWith('/*') ? mime.startsWith(s.slice(0, -1)) : mime === s,
    );
  });
}

/** With a trigger element given: its form, then the nearest ancestor that contains a file input. */
function scopedInputs(el: Element, all: HTMLInputElement[]): HTMLInputElement[] {
  const form = el.closest('form');
  if (form) {
    const inForm = all.filter((i) => form.contains(i));
    if (inForm.length) return inForm;
  }
  let scope: Node | null = el;
  while (scope) {
    const inScope = all.filter((i) => scope!.contains(i));
    if (inScope.length) return inScope;
    scope = scope.parentNode;
  }
  return all;
}

/**
 * Puts the user's files into a file input of the page: builds File objects from the dropped
 * bytes, finds the right input (by id, near the given trigger element, or page-wide, matching
 * accept/name), sets it and fires input and change the way the site's own framework expects.
 */
export function attachFiles(doc: Document, reg: ElementRegistry, req: { files: UploadFile[]; id?: number }): string {
  const files = req.files.map((f) => new File([decode(f.dataUrl)], f.name, { type: mimeOf(f.dataUrl) }));
  const names = files.map((f) => f.name);

  // Visible inputs first; hidden ones count too since that is how upload widgets are built.
  const all = collectFileInputs(doc).filter((i) => !i.disabled);
  if (!all.length) {
    throw new Error(
      'There is no file input (<input type=file>) on this page, so the files cannot be attached. If an upload dialog is open, press Escape. The page may only accept drag & drop uploads, which are not supported yet.',
    );
  }

  let pool = all;
  let via = '';
  let scoped = false;
  if (req.id !== undefined) {
    const el = reg.get(req.id);
    if (!el) throw new Error(`Element [${req.id}] no longer exists on the page. Use an id from the latest page state.`);
    const isFile = el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file';
    if (isFile) {
      pool = [el as HTMLInputElement];
      via = `file input [${req.id}]`;
    } else {
      pool = scopedInputs(el, all);
      scoped = true;
      via = `[${req.id}]`;
    }
  }

  const compatible = pool.filter((i) => accepts(i, files));
  if (!compatible.length) {
    throw new Error(
      scoped && pool !== all
        ? `No file input ${via ? `near ${via} ` : ''}accepts ${names.join(', ')} (the page's controls accept: ${describeInputs(pool)}). Check which input the page wants, or ask the user.`
        : `No file input on this page accepts ${names.join(', ')}; the page's controls accept: ${describeInputs(all)}.`,
    );
  }

  let target: HTMLInputElement | undefined;
  if (compatible.length === 1) {
    target = compatible[0];
  } else {
    // One input whose label/name matches the file name wins (a "Receipts" input for receipt.pdf).
    const stems = names.map((n) => n.split('.')[0].toLowerCase()).filter(Boolean);
    const byName = compatible.filter((i) => {
      const l = `${labelOf(i)} ${i.getAttribute('name') ?? ''} ${i.id}`.toLowerCase();
      return stems.some((s) => l.includes(s)) || names.some((n) => l.includes(n.toLowerCase()));
    });
    if (byName.length === 1) target = byName[0];
  }
  if (!target) {
    throw new Error(
      `Several file inputs on this page accept this file: ${describeInputs(compatible)}. Call attach_files again with the id of the right one.`,
    );
  }
  if (files.length > 1 && !target.multiple) {
    throw new Error(quoted(labelOf(target)) + ' accepts one file at a time. Call attach_files once per file.');
  }

  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  target.files = dt.files;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return `Attached ${names.map((n) => quoted(n)).join(', ')} to the ${quoted(labelOf(target))} file input. The page now has them.`;
}
