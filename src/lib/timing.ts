/** Phase timings, logged to the console of whichever context runs them (the service worker for the agent). */
let enabled = false;

/** Turned on by the "Log step timings" setting at the start of each task. */
export function setTimingEnabled(on: boolean): void {
  enabled = on;
}

export function logTiming(label: string, ms: number): void {
  if (enabled) console.log(`[timing] ${label}: ${Math.round(ms)}ms`);
}

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    logTiming(label, performance.now() - t0);
  }
}
