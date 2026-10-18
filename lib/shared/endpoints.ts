/**
 * The URL of each polled endpoint. The browser's SWR keys and the server's seed keys are these
 * same strings: the seed is the SWR fallback, so a key that differs would seed nothing.
 */
export const ENDPOINTS = {
  services: '/api/services',
  status: '/api/status',
  cron: '/api/cron',
  system: '/api/system',
  streams: '/api/streams',
  widgets: '/api/widgets',
} as const;
