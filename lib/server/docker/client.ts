import 'server-only';
import { httpRequest } from '../http';
import type { ServerEnv } from '../env';
import { parseContainers, type ContainerSummary } from './parse';

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 8 * 1024 * 1024;
const API_VERSION = /^\d{1,3}\.\d{1,3}$/;

/** `GET {IRIS_DOCKER_URL}/v{version}/containers/json?all=true` through the socket proxy. */
export async function fetchContainers(env: ServerEnv): Promise<ContainerSummary[]> {
  if (env.dockerUrl === undefined) throw new Error('IRIS_DOCKER_URL is not set');
  if (!API_VERSION.test(env.dockerApiVersion))
    throw new Error('IRIS_DOCKER_API_VERSION must look like 1.52');

  const base = env.dockerUrl.replace(/\/+$/, '');
  const res = await httpRequest({
    url: `${base}/v${env.dockerApiVersion}/containers/json?all=true`,
    headers: { accept: 'application/json' },
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
  });
  if (res.status !== 200) throw new Error(`Docker list returned HTTP ${res.status}`);

  let body: unknown;
  try {
    body = JSON.parse(res.body.toString('utf8'));
  } catch {
    // Never echo the body: it holds labels and mounts.
    throw new Error('Docker list reply is not valid JSON');
  }
  return parseContainers(body);
}
