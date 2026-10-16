import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { loadEnv } from '@/lib/server/env';
import { IntegrationError, createContext, type Adapter } from '@/lib/server/integrations/fetcher';

export const KEY = 'key-4f9a1c07d3b8e265';

export function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '../fixtures/integrations', name), 'utf8');
}

export function envWith(name: string, value: string) {
  return loadEnv({ [name]: value });
}

type Reply = string | Buffer | { status: number; body?: string };
export type Seen = { url: string; headers: http.IncomingHttpHeaders };

/** A fake upstream plus a real adapter context aimed at it. `routes` maps a path (with its query) to a reply. */
export async function harness(adapter: Adapter, routes: Record<string, Reply>) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    const r = routes[req.url ?? ''];
    if (r === undefined) return void res.writeHead(404).end();
    const { status, body } =
      typeof r === 'object' && !Buffer.isBuffer(r) ? r : { status: 200, body: r };
    res.writeHead(status, { 'content-type': 'application/json' }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const memo = new Map<string, Promise<unknown>>();
  const ctx = createContext({
    adapter,
    widget: { type: adapter.type as 'radarr', url: origin, host: null, fields: null },
    creds: { key: KEY },
    traefikUrl: undefined,
    cached: (subKey, _ttl, load) => {
      if (!memo.has(subKey)) memo.set(subKey, load());
      return memo.get(subKey) as Promise<never>;
    },
  });
  return {
    ctx,
    seen,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(IntegrationError);
    return (err as IntegrationError).code;
  }
  throw new Error('expected a rejection');
}
