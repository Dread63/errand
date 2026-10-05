import type { Attachment } from '@/lib/types';
import { IconFile, IconX } from '@/lib/ui/icons';

export function AttachmentTray({ items, onRemove }: { items: Attachment[]; onRemove(i: number): void }) {
  if (!items.length) return null;
  return (
    <div className="tray">
      {items.map((a, i) => (
        <div key={`${a.name}-${i}`} className={a.kind === 'image' ? 'att-img' : 'att-file'} title={a.name}>
          {a.kind === 'image' && a.dataUrl ? (
            <img src={a.dataUrl} alt={a.name} />
          ) : (
            <>
              <span className="att-badge">{a.name.split('.').pop()?.slice(0, 4).toUpperCase() || <IconFile size={14} />}</span>
              <span className="att-text">
                <span className="att-name">{a.name}</span>
                {a.meta && <span className="att-meta">{a.meta}</span>}
              </span>
            </>
          )}
          <button className="att-x" aria-label={`Remove ${a.name}`} onClick={() => onRemove(i)}>
            <IconX size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
