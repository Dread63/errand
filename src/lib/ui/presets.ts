import type { ContextMode, Profile, ReasoningEffort } from '../types';
import { newProfile } from './profileForm';

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  contextMode: ContextMode;
  contextWindow: number;
  supportsVision: boolean;
  reasoningEffort?: ReasoningEffort;
  /** Setup advice shown under the Base URL field. `code` spans are written in backticks. */
  hint?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', contextMode: 'full', contextWindow: 128000, supportsVision: true },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    contextMode: 'full',
    contextWindow: 128000,
    supportsVision: false,
    hint: 'Turn on images per model below if the model supports them.',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    contextMode: 'compact',
    contextWindow: 32768,
    supportsVision: false,
    hint: 'Start Ollama with `OLLAMA_ORIGINS=chrome-extension://*`, or it rejects requests from the extension.',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    contextMode: 'compact',
    contextWindow: 32768,
    supportsVision: false,
    hint: "Enable CORS in LM Studio's server settings.",
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    contextMode: 'full',
    contextWindow: 1_000_000,
    supportsVision: false,
    reasoningEffort: 'low',
  },
  {
    id: 'custom',
    name: 'Custom',
    baseUrl: 'http://',
    contextMode: 'standard',
    contextWindow: 32768,
    supportsVision: false,
    hint: 'Any OpenAI-compatible endpoint, ending in `/v1`.',
  },
];

/** A new, unsaved profile pre-filled from a preset. The user still picks a model. */
export function profileFromPreset(preset: ProviderPreset): Profile {
  const { name, baseUrl, contextMode, contextWindow, supportsVision, reasoningEffort } = preset;
  return {
    ...newProfile(),
    name,
    baseUrl,
    contextMode,
    contextWindow,
    supportsVision,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}
