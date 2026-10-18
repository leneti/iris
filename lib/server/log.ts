import 'server-only';
import { shared } from './shared';

const REDACTED = '[redacted]';
const SENSITIVE_KEY = /key|token|password|authorization|cookie/i;
const secrets = shared('log:secrets', () => new Set<string>());

export function registerSecret(value: string): void {
  if (value) secrets.add(value);
}

function scrub(text: string): string {
  let out = text;
  // Longest first so a secret that contains another one is fully removed.
  for (const s of [...secrets].sort((a, b) => b.length - a.length))
    out = out.split(s).join(REDACTED);
  return out;
}

function clean(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrub(value);
  if (value instanceof Error) return scrub(value.message);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => clean(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[scrub(k)] = SENSITIVE_KEY.test(k) ? REDACTED : clean(v, seen);
  }
  return out;
}

function write(
  level: 'info' | 'warn' | 'error',
  message: string,
  fields?: Record<string, unknown>,
) {
  const base = { time: new Date().toISOString(), level, message: scrub(message) };
  // A log call sits inside catch blocks: it must never throw (a throwing getter, say), or it
  // would replace the error it reports. Fall back to the line without its fields.
  let text: string;
  try {
    text = JSON.stringify(fields ? { ...base, fields: clean(fields, new WeakSet()) } : base);
  } catch {
    text = JSON.stringify(base);
  }
  const stream = level === 'info' ? process.stdout : process.stderr;
  stream.write(`${scrub(text)}\n`);
}

export const log = {
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};
