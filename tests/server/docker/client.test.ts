import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchContainers } from '@/lib/server/docker/client';
import { loadEnv } from '@/lib/server/env';

let server: http.Server | undefined;
let lastUrl = '';

async function serve(handler: http.RequestListener): Promise<string> {
  const srv = http.createServer((req, res) => {
    lastUrl = req.url ?? '';
    handler(req, res);
  });
  server = srv;
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

const envFor = (url: string | undefined, version?: string) =>
  loadEnv({
    DASHBOARD_DOCKER_URL: url,
    ...(version ? { DASHBOARD_DOCKER_API_VERSION: version } : {}),
  });

describe('fetchContainers', () => {
  it('requests the versioned list endpoint and parses the reply', async () => {
    const base = await serve((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify([
          { Names: ['/a'], State: 'running', Status: 'Up', Mounts: [{ Source: '/x' }] },
        ]),
      );
    });
    const out = await fetchContainers(envFor(`${base}/`));
    expect(lastUrl).toBe('/v1.52/containers/json?all=true');
    expect(out.map((c) => c.name)).toEqual(['a']);
    expect(JSON.stringify(out)).not.toContain('Mounts');
  });

  it('uses the configured API version', async () => {
    const base = await serve((_req, res) => res.end('[]'));
    await fetchContainers(envFor(base, '1.54'));
    expect(lastUrl).toBe('/v1.54/containers/json?all=true');
  });

  it('rejects a version that is not major.minor', async () => {
    await expect(fetchContainers(envFor('http://127.0.0.1:1', '1.52/../x'))).rejects.toThrow(
      /version/i,
    );
  });

  it('throws when no Docker address is configured', async () => {
    await expect(fetchContainers(envFor(undefined))).rejects.toThrow(/DASHBOARD_DOCKER_URL/);
  });

  it('throws on a non-200 reply', async () => {
    const base = await serve((_req, res) => {
      res.statusCode = 403;
      res.end('denied');
    });
    await expect(fetchContainers(envFor(base))).rejects.toThrow(/403/);
  });

  it('throws on invalid JSON without echoing the body', async () => {
    const base = await serve((_req, res) => res.end('secret-body'));
    await expect(fetchContainers(envFor(base))).rejects.toThrow(/JSON/);
    await expect(fetchContainers(envFor(base))).rejects.not.toThrow(/secret-body/);
  });
});
