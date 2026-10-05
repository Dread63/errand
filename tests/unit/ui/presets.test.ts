import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS, profileFromPreset } from '@/lib/ui/presets';
import { validateProfile } from '@/lib/ui/profileForm';

const preset = (id: string) => PROVIDER_PRESETS.find((p) => p.id === id)!;

describe('provider presets', () => {
  it('offers the providers from the spec, in order', () => {
    expect(PROVIDER_PRESETS.map((p) => p.id)).toEqual(['openai', 'openrouter', 'ollama', 'lmstudio', 'opencode-go', 'custom']);
  });

  it('every real provider makes a valid profile once a model is picked', () => {
    for (const p of PROVIDER_PRESETS.filter((p) => p.id !== 'custom')) {
      expect(validateProfile({ ...profileFromPreset(p), model: 'm' }), p.id).toEqual([]);
    }
  });

  it('creates a fresh profile named after the preset with no model chosen', () => {
    const a = profileFromPreset(preset('openai'));
    const b = profileFromPreset(preset('openai'));
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '', supportsVision: true, contextMode: 'full' });
    expect(profileFromPreset(preset('opencode-go')).reasoningEffort).toBe('low');
    expect('reasoningEffort' in a).toBe(false);
  });

  it('explains the CORS setup local servers need', () => {
    expect(preset('ollama').hint).toContain('OLLAMA_ORIGINS=chrome-extension://*');
    expect(preset('lmstudio').hint).toMatch(/CORS/);
  });
});
