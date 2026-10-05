import fs from 'node:fs';

/** Starts each live run with an empty results file. */
export default function setup(): void {
  fs.rmSync('test-results/live-results.jsonl', { force: true });
}
