export function originOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'invalid:';
  }
}

export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function normalizeNavUrl(input: string): string {
  const s = input.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
}
