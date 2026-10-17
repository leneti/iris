import { afterEach, expect, test, vi } from 'vitest';
import { loadEnv } from '@/lib/server/env';
import { log, registerSecret } from '@/lib/server/log';

afterEach(() => vi.restoreAllMocks());

function capture(stream: 'stdout' | 'stderr', fn: () => void): string {
  let out = '';
  vi.spyOn(process[stream], 'write').mockImplementation(((chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write);
  fn();
  return out;
}

test('registered secrets never reach output', () => {
  registerSecret('s3cr3t-value');
  const out = capture('stdout', () =>
    log.info('call failed s3cr3t-value', { header: 's3cr3t-value', apiKey: 'x' }),
  );
  expect(out).not.toContain('s3cr3t-value');
  expect(out).toContain('[redacted]');
  expect(out.trim().split('\n')).toHaveLength(1);
});

test('sensitive keys are redacted, nested too', () => {
  const out = capture('stdout', () =>
    log.info('x', {
      Authorization: 'Bearer q',
      nested: { cookie: 'c', ok: 'fine' },
      list: [{ password: 'p' }],
    }),
  );
  const parsed = JSON.parse(out);
  expect(parsed.fields.Authorization).toBe('[redacted]');
  expect(parsed.fields.nested).toEqual({ cookie: '[redacted]', ok: 'fine' });
  expect(parsed.fields.list[0].password).toBe('[redacted]');
  expect(parsed.fields.nested.ok).toBe('fine');
});

test('warn and error go to stderr', () => {
  expect(capture('stderr', () => log.warn('w'))).toContain('"level":"warn"');
  expect(capture('stderr', () => log.error('e'))).toContain('"level":"error"');
});

test('loadEnv registers credentials', () => {
  loadEnv({ IRIS_GOTIFY_TOKEN: 'tok-from-env-123' });
  const out = capture('stdout', () => log.info('leak tok-from-env-123'));
  expect(out).not.toContain('tok-from-env-123');
});

test('ignores empty secrets and handles errors and circular values', () => {
  registerSecret('');
  const a: Record<string, unknown> = {};
  a.self = a;
  const out = capture('stdout', () => log.info('hello', { err: new Error('boom'), a }));
  expect(out).toContain('hello');
  expect(out).toContain('boom');
});

test('a BigInt field is written as a string, not thrown on', () => {
  const out = capture('stdout', () => log.info('big', { n: 12345678901234567890n }));
  expect(JSON.parse(out).fields.n).toBe('12345678901234567890');
});

test('a field that cannot be serialised never makes the log call throw', () => {
  const bad = {
    get boom(): string {
      throw new Error('getter exploded');
    },
  };
  let out = '';
  expect(() => {
    out = capture('stderr', () => log.error('failed after the catch', { bad }));
  }).not.toThrow();
  const parsed = JSON.parse(out);
  expect(parsed.level).toBe('error');
  expect(parsed.message).toBe('failed after the catch');
  expect(parsed.fields).toBeUndefined();
});
