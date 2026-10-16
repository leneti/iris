import 'server-only';
import { z } from 'zod';
import type { StandaloneWidget, Stat, WidgetState } from '@/lib/shared/contract';
import { IntegrationError, type Adapter, type AdapterContext } from './fetcher';
import { parseReply } from './reply';
import type { WidgetDeps } from './registry';

// Markets (D1.12): one read of CoinMarketCap's latest quotes for all configured coins, cached
// for `widgets.refreshSeconds.coinmarketcap` (1800 s). All four intervals come in that one reply.
const SYMBOL = /^[A-Z0-9]{1,10}$/;
const CURRENCY = /^[A-Z0-9]{2,10}$/;
const INTERVALS = ['1h', '24h', '7d', '30d'] as const;

const pct = z.number().finite().nullable().optional();
const quote = z.object({
  price: z.number().finite(),
  percent_change_1h: pct,
  percent_change_24h: pct,
  percent_change_7d: pct,
  percent_change_30d: pct,
});
// v1 gives one object per symbol; the newer shape gives a list. Take the first of a list.
const entry = z.object({ quote: z.record(z.string(), quote) });
const schema = z.object({ data: z.record(z.string(), z.union([entry, z.array(entry)])) });

export type CoinQuote = {
  price: number;
  changePercent: Record<(typeof INTERVALS)[number], number | null>;
};

export const adapter: Adapter = {
  type: 'coinmarketcap',
  defaultFields: [],
  extraFields: [],
  labels: {},
  baseUrl: 'https://pro-api.coinmarketcap.com',
  credentials: (env) => (env.coinmarketcapKey ? { key: env.coinmarketcapKey } : null),
  // Not a per-service integration: the provider below calls `readQuotes` with the config.
  fetch: () => Promise.reject(new IntegrationError('unreachable')),
};

/** Reads the quotes for `symbols` (already validated) in `currency` (already validated). */
export async function readQuotes(
  ctx: AdapterContext,
  symbols: string[],
  currency: string,
): Promise<Map<string, CoinQuote>> {
  const res = await ctx.get(
    `/v1/cryptocurrency/quotes/latest?symbol=${symbols.join(',')}&convert=${currency}`,
    { headers: { 'X-CMC_PRO_API_KEY': ctx.creds.key! } },
  );
  const { data } = parseReply(res, schema);
  const out = new Map<string, CoinQuote>();
  for (const symbol of symbols) {
    const raw = Object.hasOwn(data, symbol) ? data[symbol] : undefined;
    const q = (Array.isArray(raw) ? raw[0] : raw)?.quote;
    const row = q !== undefined && Object.hasOwn(q, currency) ? q[currency] : undefined;
    if (row === undefined) continue;
    out.set(symbol, {
      price: row.price,
      changePercent: {
        '1h': row.percent_change_1h ?? null,
        '24h': row.percent_change_24h ?? null,
        '7d': row.percent_change_7d ?? null,
        '30d': row.percent_change_30d ?? null,
      },
    });
  }
  return out;
}

const ICON = /^lucide:([a-z0-9][a-z0-9-]*)$/;

export async function provider(deps: WidgetDeps): Promise<StandaloneWidget[]> {
  const { config, env, cache } = deps;
  const creds = adapter.credentials(env);
  return Promise.all(
    config.widgets.standalone.map(async (spec): Promise<StandaloneWidget> => {
      const symbols = [...new Set(spec.coins.map((c) => c.symbol).filter((s) => SYMBOL.test(s)))];
      const base = {
        id: spec.id,
        name: spec.name,
        group: spec.group ?? config.defaultGroup,
        icon: { kind: 'lucide' as const, name: ICON.exec(spec.icon ?? '')?.[1] ?? 'chart-line' },
        type: spec.type,
        interval: spec.interval,
      };
      const empty = (state: WidgetState, fetchedAt: number | null = null): StandaloneWidget => ({
        ...base,
        state,
        fetchedAt: fetchedAt === null ? null : new Date(fetchedAt).toISOString(),
        stats: [],
      });
      if (creds === null) return empty('not-configured');
      if (symbols.length < spec.coins.length)
        deps.warnOnce(
          `markets-symbol:${spec.id}`,
          'markets: a coin symbol is not A-Z or 0-9 (1 to 10 characters) and was dropped',
          { id: spec.id },
        );
      if (symbols.length === 0 || !CURRENCY.test(spec.currency)) {
        if (!CURRENCY.test(spec.currency))
          deps.warnOnce(`markets-currency:${spec.id}`, 'markets: the currency is not valid', {
            id: spec.id,
          });
        return empty('not-configured');
      }

      const result = await cache.get(
        `coinmarketcap:${spec.id}|${spec.currency}|${symbols.join(',')}`,
        deps.refreshMs('coinmarketcap'),
        () => readQuotes(deps.context(adapter, creds), symbols, spec.currency),
      );
      if (result.error !== null || result.value === null)
        return empty(
          result.error instanceof IntegrationError ? result.error.code : 'unreachable',
          result.fetchedAt,
        );

      const quotes = result.value;
      const stats: Stat[] = [];
      for (const coin of spec.coins) {
        const q = quotes.get(coin.symbol);
        if (q === undefined || stats.some((s) => s.key === coin.symbol)) continue;
        stats.push({
          key: coin.symbol,
          label: coin.name,
          value: q.price,
          unit: spec.currency,
          changePercent: q.changePercent,
        });
      }
      return { ...base, state: 'ok', fetchedAt: new Date(result.fetchedAt!).toISOString(), stats };
    }),
  );
}
