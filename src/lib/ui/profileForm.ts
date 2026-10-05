import type { Profile } from '../types';

export function newProfile(): Profile {
  return {
    id: crypto.randomUUID(),
    name: 'New profile',
    baseUrl: 'http://',
    apiKey: '',
    model: '',
    supportsVision: false,
    contextMode: 'standard',
    contextWindow: 32768,
    maxScreenshots: 3,
  };
}

export function validateProfile(p: Profile): string[] {
  const errors: string[] = [];
  if (!p.name.trim()) errors.push('Name is required.');
  if (!/^https?:\/\/[^/\s]+/i.test(p.baseUrl.trim())) errors.push('Base URL must start with http:// or https://.');
  if (!p.model.trim()) errors.push('Model is required.');
  if (!Number.isInteger(p.contextWindow) || p.contextWindow < 2048) errors.push('Context window must be a whole number of at least 2048 tokens.');
  if (!Number.isInteger(p.maxScreenshots) || p.maxScreenshots < 1 || p.maxScreenshots > 10) errors.push('Screenshots kept must be between 1 and 10.');
  return errors;
}

export function parseKeywords(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}
