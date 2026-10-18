import useSWR, { type SWRResponse } from 'swr';
import type { z } from 'zod';
import {
  CronResponse,
  ServicesResponse,
  StatusResponse,
  StreamsResponse,
  SystemResponse,
  WidgetsResponse,
  parseTolerant,
} from '@/lib/shared/contract';
import { ENDPOINTS } from '@/lib/shared/endpoints';
import { markOk } from './source-health';

/** Browser polling intervals in milliseconds (Global Constraints, Timing). */
export const POLL_MS = {
  status: 10_000,
  cron: 60_000,
  system: 10_000,
  streams: 15_000,
  widgets: 10_000,
  services: 30_000,
} as const;

/** Polling stops while the document is hidden. */
export function pollOptions(refreshInterval: number) {
  return { refreshInterval, refreshWhenHidden: false } as const;
}

/**
 * GET a JSON endpoint and check it against its contract schema. Anything that is not a 2xx
 * with a conforming body rejects, so SWR reports an error and unvalidated data never reaches
 * the UI. Fields the schema does not know are dropped, not rejected (R49): a server deployed
 * after this page was loaded may add fields. The message never includes the response body.
 */
export async function fetchValidated<T>(schema: z.ZodType<T>, url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`${url} did not return JSON`);
  }
  const parsed = parseTolerant(schema, body);
  if (!parsed.success) throw new Error(`${url} did not match the contract`);
  markOk(url);
  return parsed.data;
}

function useEndpoint<T>(url: string, schema: z.ZodType<T>, ms: number): SWRResponse<T, Error> {
  return useSWR<T, Error>(url, () => fetchValidated(schema, url), pollOptions(ms));
}

export const useServices = () =>
  useEndpoint(ENDPOINTS.services, ServicesResponse, POLL_MS.services);
export const useStatus = () => useEndpoint(ENDPOINTS.status, StatusResponse, POLL_MS.status);
export const useCron = () => useEndpoint(ENDPOINTS.cron, CronResponse, POLL_MS.cron);
export const useSystem = () => useEndpoint(ENDPOINTS.system, SystemResponse, POLL_MS.system);
export const useStreams = () => useEndpoint(ENDPOINTS.streams, StreamsResponse, POLL_MS.streams);
export const useWidgets = () => useEndpoint(ENDPOINTS.widgets, WidgetsResponse, POLL_MS.widgets);
