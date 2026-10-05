import { useRef, useState } from 'react';
import { readAttachment } from '@/lib/attachments';
import type { Attachment } from '@/lib/types';

interface Props {
  running: boolean;
  vision: boolean;
  onSend(text: string, attachments: Attachment[]): void;
  onStop(): void;
}

export function Composer({ running, vision, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: File[]) {
    setErr(null);
    for (const f of files) {
      try {
        const a = await readAttachment(f);
        if (a.kind === 'image' && !vision) {
          setErr(`"${f.name}" is an image, but the selected model profile does not support vision.`);
          continue;
        }
        setAtts((prev) => [...prev, a]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    }
  }

  function submit() {
    const t = text.trim();
    if (!t || running) return;
    onSend(t, atts);
    setText('');
    setAtts([]);
  }

  return (
    <div
      className="composer"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {atts.length > 0 && (
        <div className="chips">
          {atts.map((a, i) => (
            <span className="chip" key={`${a.name}-${i}`}>
              {a.name}
              <button aria-label={`Remove ${a.name}`} onClick={() => setAtts((p) => p.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      )}
      {err && <div className="composer-error" role="alert">{err}</div>}
      <textarea
        data-testid="composer-input"
        value={text}
        placeholder="What should I do?"
        rows={3}
        onChange={(e) => setText(e.target.value)}
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
      <div className="composer-row">
        <button onClick={() => fileRef.current?.click()} disabled={running}>Attach</button>
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
        {running ? (
          <button className="danger" data-testid="composer-stop" onClick={onStop}>Stop</button>
        ) : (
          <button className="primary" data-testid="composer-send" onClick={submit} disabled={!text.trim()}>Send</button>
        )}
      </div>
    </div>
  );
}
