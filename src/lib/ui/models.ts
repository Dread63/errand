import type { Attachment, Profile } from '../types';

export interface CatalogEntry {
  models: string[];
  fetchedAt: number;
  error?: string;
}

export interface MenuGroup {
  profileId: string;
  name: string;
  models: string[];
  error?: string;
}

const UPPER = new Set(['glm', 'gpt', 'llm', 'vl', 'moe']);

/** "glm-5.3-flash" → "GLM 5.3 Flash"; drops an "org/" prefix. */
export function prettyModel(id: string): string {
  const base = id.split('/').pop()!.trim();
  if (!base) return 'Choose a model';
  return base
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => {
      if (UPPER.has(w.toLowerCase())) return w.toUpperCase();
      if (/^\d+(\.\d+)?[a-z]$/i.test(w) || /^[a-z]\d+[a-z]?$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

export function supportsVisionFor(p: Pick<Profile, 'supportsVision' | 'visionModels'>, model: string): boolean {
  return p.visionModels && p.visionModels.length > 0 ? p.visionModels.includes(model) : p.supportsVision;
}

export function filterModels(ids: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  return q ? ids.filter((id) => id.toLowerCase().includes(q)) : ids;
}

export function menuGroups(profiles: Profile[], catalog: Record<string, CatalogEntry | undefined>, query: string): MenuGroup[] {
  const out: MenuGroup[] = [];
  for (const p of profiles) {
    const entry = catalog[p.id];
    const current = p.model.trim();
    const all = [...(current ? [current] : []), ...(entry?.models ?? []).filter((m) => m !== current)];
    const models = filterModels(all, query);
    if (query.trim() && models.length === 0) continue;
    out.push({ profileId: p.id, name: p.name, models, ...(entry?.error ? { error: entry.error } : {}) });
  }
  return out;
}

/** The profile tasks run with: the stored active one, else the first, so a stale id never leaves Send dead. */
export function activeProfile(profiles: Profile[], activeId: string | null): Profile | null {
  return profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null;
}

export function canSend(p: Profile | null): boolean {
  return !!p && p.model.trim().length > 0;
}

/** Why Send is blocked for these attachments, or null. Checked before sending so the draft is kept. */
export function sendBlock(atts: Attachment[], vision: boolean): string | null {
  const img = atts.find((a) => a.kind === 'image');
  return img && !vision ? `"${img.name}" is an image, but the selected model does not support images. Remove it or pick a vision model.` : null;
}

/** Models offered in the vision picker: current, saved, fetched and cached ids, in that order. */
export function visionChoices(p: Profile, fetched: string[], cached: string[] | undefined): string[] {
  const out: string[] = [];
  for (const m of [p.model.trim(), ...(p.visionModels ?? []), ...fetched, ...(cached ?? [])]) if (m && !out.includes(m)) out.push(m);
  return out;
}
