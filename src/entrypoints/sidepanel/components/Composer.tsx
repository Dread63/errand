import { type ReactNode, useRef, useState } from 'react';
import { readAttachment } from '@/lib/attachments';
import type { Attachment } from '@/lib/types';
import { IconPaperclip, IconSend, IconStop } from '@/lib/ui/icons';
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

  function grow() {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function submit() {
    const t = text.trim();
    if (!t || running || !ready) return;
    onSend(t, atts);
    setText('');
    setAtts([]);
    requestAnimationFrame(grow);
  }

  return (
    <div
      className={`composer${dragging ? ' dragging' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {dragging && <div className="dropzone">Drop files to attach</div>}
      <AttachmentTray items={atts} onRemove={(i) => setAtts((p) => p.filter((_, j) => j !== i))} />
      {err && <div className="composer-error" role="alert">{err}</div>}
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
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            void addFiles(files);
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
            title={ready ? 'Send' : 'Choose a model first'}
            onClick={submit}
            disabled={!text.trim() || !ready}
          >
            <IconSend size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
