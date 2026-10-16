import 'server-only';
import { readFileSync, statSync } from 'node:fs';
import { HostStatusFile } from '@/lib/shared/contract';

// The host status file (handoff D1.5, §8.3), written by the exporter every 5 minutes. It is
// ignored when its generatedAt is older than 15 minutes.

export const HOST_STATUS_MAX_AGE_MS = 15 * 60_000;
/** A generatedAt this far ahead of the clock cannot be trusted either. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_FILE_BYTES = 256 * 1024;

export type HostStatusState = 'ok' | 'stale' | 'not-configured' | 'unreachable';
export type HostStatusRead = { state: HostStatusState; file: HostStatusFile | null };

export function readHostStatus(path: string | undefined, now: Date): HostStatusRead {
  if (!path) return { state: 'not-configured', file: null };
  let text: string;
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return { state: 'unreachable', file: null };
    text = readFileSync(path, 'utf8');
  } catch (error) {
    // A missing file is what the panel shows as stale (criterion 5.8): no exporter output yet.
    return {
      state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'stale' : 'unreachable',
      file: null,
    };
  }
  let parsed: ReturnType<typeof HostStatusFile.safeParse>;
  try {
    parsed = HostStatusFile.safeParse(JSON.parse(text));
  } catch {
    return { state: 'unreachable', file: null };
  }
  if (!parsed.success) return { state: 'unreachable', file: null };
  const age = now.getTime() - Date.parse(parsed.data.generatedAt);
  if (age > HOST_STATUS_MAX_AGE_MS || age < -MAX_CLOCK_SKEW_MS)
    return { state: 'stale', file: null };
  return { state: 'ok', file: parsed.data };
}
