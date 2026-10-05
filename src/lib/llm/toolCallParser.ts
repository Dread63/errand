type Parsed = { name: string; args: Record<string, unknown> };

function balancedObjects(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"' && depth > 0) inStr = true;
    else if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0) out.push(s.slice(start, i + 1));
    }
  }
  return out;
}

function normalize(o: unknown, names: string[]): Parsed | null {
  if (!o || typeof o !== 'object') return null;
  const outer = o as Record<string, unknown>;
  const fn = (outer.function && typeof outer.function === 'object' ? outer.function : outer) as Record<string, unknown>;
  const name = fn.name ?? fn.tool ?? fn.action;
  let args = fn.arguments ?? fn.args ?? fn.parameters ?? fn.input ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (typeof name !== 'string' || !names.includes(name)) return null;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  return { name, args: args as Record<string, unknown> };
}

export function extractToolCallFromText(text: string, toolNames: string[]): Parsed | null {
  const candidates = [
    ...[...text.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)].map((m) => m[1]),
    ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]),
    ...balancedObjects(text),
  ];
  for (const c of candidates) {
    try {
      const parsed = normalize(JSON.parse(c.trim()), toolNames);
      if (parsed) return parsed;
    } catch {
      // not JSON; try the next candidate
    }
  }
  return null;
}
