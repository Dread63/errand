import { type ReactNode, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { IconCheck, IconCopy } from '@/lib/ui/icons';

export function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:' ? href : undefined;
  } catch {
    return undefined;
  }
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-pre">
      <button
        className="md-copy"
        aria-label="Copy code"
        onClick={(e) => {
          const text = (e.currentTarget.nextElementSibling as HTMLElement | null)?.innerText ?? '';
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

const components: Components = {
  a: ({ href, children }) => {
    const safe = safeHref(href);
    return safe ? (
      <a href={safe} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
  img: ({ alt }) => <span>{alt}</span>,
};

/** Assistant text as GitHub-flavoured markdown. Raw HTML is never rendered (no rehype-raw). */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={(url) => safeHref(url) ?? ''}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
