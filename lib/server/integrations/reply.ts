import 'server-only';
import type { ZodType } from 'zod';
import { IntegrationError } from './fetcher';
import type { HttpResult } from '../http';

/** Parses a reply body with a tolerant schema. Malformed JSON or shape: "unreachable". */
export function parseReply<T>(res: HttpResult, schema: ZodType<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(res.body.toString('utf8'));
  } catch {
    throw new IntegrationError('unreachable');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new IntegrationError('unreachable');
  return parsed.data;
}
