import type { ContextMode, ElementInfo, PageSnapshot, TabInfo } from '../types';
import { clip } from '../util';
import { MODE_LIMITS } from './modes';

export function renderElement(e: ElementInfo, mode: ContextMode): string {
  let s = `[${e.id}] ${e.role}`;
  if (e.name) s += ` "${clip(e.name, 80)}"`;
  if (e.type && e.tag === 'input') s += ` type=${e.type}`;
  if (e.value) s += ` value="${clip(e.value, 60)}"`;
  if (e.checked !== undefined) s += e.checked ? ' checked' : ' unchecked';
  if (e.disabled) s += ' disabled';
  if (e.group) s += ` in "${clip(e.group, 80)}"`;
  if (e.options) {
    const shown = e.options.slice(0, 10).map((o) => `"${clip(o, 30)}"`);
    s += ` options=[${shown.join(', ')}${e.options.length > 10 ? ', …' : ''}]`;
  }
  if (e.href && mode !== 'compact') s += ` → ${clip(e.href, 80)}`;
  if (mode === 'full' && e.context) s += ` — ${clip(e.context, 100)}`;
  return s;
}

export function renderSnapshot(
  snap: PageSnapshot,
  tabs: TabInfo[],
  mode: ContextMode,
): { detail: string; summary: string; tabs: string } {
  const tabText = tabs.map((t) => `${t.active ? '*' : ' '} ${t.index}: ${clip(t.title, 50)} — ${t.url}`).join('\n');
  if (snap.restricted) {
    return {
      detail: `URL: ${snap.url}\nThis page cannot be controlled (it is a browser-internal page). Use navigate or new_tab to go to a website.`,
      summary: `${snap.url} (browser page)`,
      tabs: tabText,
    };
  }
  const lines = [`URL: ${snap.url}`, `Title: ${snap.title}`];
  if (snap.scrollMaxY > 0) lines.push(`Scroll: ${Math.round((snap.scrollY / snap.scrollMaxY) * 100)}% (more content ${snap.scrollY < snap.scrollMaxY ? 'below' : 'above'})`);
  if (mode === 'full' && snap.headings.length) lines.push(`Headings: ${snap.headings.join(' | ')}`);
  lines.push('Elements:');
  const budgetChars = MODE_LIMITS[mode].elementTokens * 4;
  let used = 0;
  let shown = 0;
  for (const e of snap.elements) {
    const line = renderElement(e, mode);
    if (used + line.length > budgetChars) break;
    lines.push(line);
    used += line.length + 1;
    shown++;
  }
  if (shown < snap.elements.length) lines.push(`…[${snap.elements.length - shown} more elements not shown; scroll or use read_text]`);
  if (snap.elements.length === 0) lines.push('(no interactive elements visible)');
  return {
    detail: lines.join('\n'),
    summary: `${snap.title || snap.url} (${snap.url}) — ${snap.elements.length} elements`,
    tabs: tabText,
  };
}
