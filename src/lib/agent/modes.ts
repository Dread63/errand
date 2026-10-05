import type { ContextMode, Profile } from '../types';

export interface ModeLimits {
  elementTokens: number;
  readTextTokens: number;
  /** How many prior step observations are rendered in full (the current one always is). */
  fullObservations: number;
  screenshots(p: Profile): number;
  attachmentChars(p: Profile, count: number): number;
  /** Snapshot only elements inside the viewport. */
  viewportOnly: boolean;
}

export const MODE_LIMITS: Record<ContextMode, ModeLimits> = {
  compact: {
    elementTokens: 4000,
    readTextTokens: 3000,
    fullObservations: 0,
    screenshots: () => 1,
    attachmentChars: () => 20_000,
    viewportOnly: true,
  },
  standard: {
    elementTokens: 10_000,
    readTextTokens: 12_000,
    fullObservations: 2,
    screenshots: () => 1,
    attachmentChars: () => 60_000,
    viewportOnly: true,
  },
  full: {
    elementTokens: 20_000,
    readTextTokens: 50_000,
    fullObservations: Number.POSITIVE_INFINITY,
    screenshots: (p) => Math.max(1, p.maxScreenshots),
    attachmentChars: (p, count) => Math.floor((p.contextWindow * 4 * 0.5) / Math.max(1, count)),
    viewportOnly: false,
  },
};
