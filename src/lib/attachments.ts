import type { Attachment } from './types';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 20 * 1024 * 1024;

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|bash|zsh|fish|ya?ml|toml|ini|cfg|conf|log|sql|env)$/i;

export interface AttachmentDeps {
  pdfToText?: (file: File) => Promise<string>;
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
    return { name: file.name, kind: 'image', dataUrl: await toDataUrl(file) };
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfToText = deps.pdfToText ?? (await import('./pdf')).pdfToText;
    return { name: file.name, kind: 'text', text: await pdfToText(file) };
  }
  if (file.type.startsWith('text/') || /json|xml|javascript|yaml|toml/.test(file.type) || TEXT_EXT.test(file.name)) {
    if (file.size > MAX_TEXT_BYTES) throw new Error(`"${file.name}" is larger than 20 MB.`);
    return { name: file.name, kind: 'text', text: await file.text() };
  }
  throw new Error(`Unsupported file type for "${file.name}". Attach images, PDFs or text files.`);
}
