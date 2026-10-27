import type { Attachment, Turn, UploadFile } from './types';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 20 * 1024 * 1024;
/** Original files above this size are not kept around for uploading, only their content is. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|bash|zsh|fish|ya?ml|toml|ini|cfg|conf|log|sql|env)$/i;

export interface AttachmentDeps {
  pdfToText?: (file: File) => Promise<{ text: string; pages: number }>;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = v >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1);
  return `${s} ${units[i]}`;
}

async function toDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${file.type};base64,${btoa(bin)}`;
}

export async function readAttachment(file: File, deps: AttachmentDeps = {}): Promise<Attachment> {
  if (file.type.startsWith('image/')) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`"${file.name}" is larger than 10 MB.`);
    return { name: file.name, kind: 'image', dataUrl: await toDataUrl(file), meta: formatBytes(file.size) };
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfToText = deps.pdfToText ?? (await import('./pdf')).pdfToText;
    const { text, pages } = await pdfToText(file);
    // The original bytes are kept so the agent can upload the file to a page (attach_files).
    const dataUrl = file.size <= MAX_UPLOAD_BYTES ? await toDataUrl(file) : undefined;
    return { name: file.name, kind: 'text', text, dataUrl, meta: `${pages} page${pages === 1 ? '' : 's'}` };
  }
  if (file.type.startsWith('text/') || /json|xml|javascript|yaml|toml/.test(file.type) || TEXT_EXT.test(file.name)) {
    if (file.size > MAX_TEXT_BYTES) throw new Error(`"${file.name}" is larger than 20 MB.`);
    return { name: file.name, kind: 'text', text: await file.text(), dataUrl: await toDataUrl(file), meta: formatBytes(file.size) };
  }
  throw new Error(`Unsupported file type for "${file.name}". Attach images, PDFs or text files.`);
}

/** Every file in the conversation that has original bytes, ready for the attach_files tool. */
export function uploadsFromTurns(turns: Turn[]): UploadFile[] {
  const out: UploadFile[] = [];
  for (const t of turns) {
    if (t.kind !== 'user') continue;
    for (const a of t.attachments) if (a.dataUrl) out.push({ name: a.name, dataUrl: a.dataUrl });
  }
  return out;
}
