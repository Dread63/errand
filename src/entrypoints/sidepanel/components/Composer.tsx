import { type ReactNode, useEffect, useRef, useState } from 'react';
import { readAttachment } from '@/lib/attachments';
import type { Attachment } from '@/lib/types';
import { IconPaperclip, IconSend, IconStop } from '@/lib/ui/icons';
import { sendBlock } from '@/lib/ui/models';
import { AttachmentTray } from './AttachmentTray';

interface Props {
  running: boolean;
  vision: boolean;
  ready: boolean;
  modelMenu: ReactNode;
  onSend(text: string, attachments: Attachment[]): void;
  onStop(): void;
}

export function Composer({ running, vision, ready, modelMenu, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const blocked = sendBlock(atts, vision);

  async function addFiles(files: File[]) {
    setErr(null);
    for (const f of files) {
      try {
        const a = await readAttachment(f);
        if (a.kind === 'image' && !vision) {
          setErr(`"${f.name}" is an image, but the selected model does not support images.`);
          continue;
        }
        setAtts((prev) => [...prev, a]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    }
  }

  // Files can be dropped anywhere in the panel, not only on the input box.
  const addRef = useRef(addFiles);
  addRef.current = addFiles;
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      void addRef.current(Array.from(e.dataTransfer!.files));
    };
    // Paste works anywhere in the panel; items catches images that clipboardData.files misses.
    const paste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.kind === 'file')
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      if (!files.length) return;
      e.preventDefault();
      void addRef.current(files);
    };
    document.addEventListener('paste', paste);
    document.addEventListener('dragenter', over);
    document.addEventListener('dragover', over);
    document.addEventListener('dragleave', leave);
    document.addEventListener('drop', drop);
    return () => {
      document.removeEventListener('paste', paste);
      document.removeEventListener('dragenter', over);
      document.removeEventListener('dragover', over);
      document.removeEventListener('dragleave', leave);
      document.removeEventListener('drop', drop);
    };
  }, []);

  function grow() {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function submit() {
    const t = text.trim();
    if (!t || running || !ready || blocked) return;
    onSend(t, atts);
    setText('');
    setAtts([]);
    requestAnimationFrame(grow);
  }

  return (
    <div className={`composer${dragging ? ' dragging' : ''}`}>
      {dragging && <div className="dropzone">Drop files to attach</div>}
      <AttachmentTray items={atts} onRemove={(i) => setAtts((p) => p.filter((_, j) => j !== i))} />
      {(err || blocked) && <div className="composer-error" role="alert">{err ?? blocked}</div>}
      <textarea
        ref={area}
        data-testid="composer-input"
        value={text}
        placeholder="Ask anything…"
        rows={1}
        onChange={(e) => {
          setText(e.target.value);
          grow();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-bar">
        <button className="icon-btn" aria-label="Attach files" title="Attach images, PDFs or text files" onClick={() => fileRef.current?.click()} disabled={running}>
          <IconPaperclip />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
        {modelMenu}
        {running ? (
          <button className="round-btn stop" aria-label="Stop" data-testid="composer-stop" onClick={onStop}>
            <IconStop size={14} />
          </button>
        ) : (
          <button
            className="round-btn"
            aria-label="Send"
            data-testid="composer-send"
            title={blocked ?? (ready ? 'Send' : 'Choose a model first')}
            onClick={submit}
            disabled={!text.trim() || !ready || !!blocked}
          >
            <IconSend size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
