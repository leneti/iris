import { effectiveEmbed, frameUrl, type AddressMode } from '@/lib/client/address';
import type { EmbedInfo, ServiceEntry } from '@/lib/shared/contract';

/** Why a tab shows the fallback card instead of an iframe. */
export type CardKind = NonNullable<EmbedInfo['reason']> | 'home-only' | 'device';

export type FrameContext = {
  mode: AddressMode;
  hostname: string;
  /** `window.location.protocol`: an https page may not frame plain http. */
  protocol: string;
  /** This device always opens the service in a browser tab. */
  alwaysNewTab: boolean;
};

export type FrameModel = {
  service: ServiceEntry;
  /** What the iframe loads and "Open in new tab" opens; null when there is no address. */
  url: string | null;
  embed: EmbedInfo;
  /** Null: show the iframe. */
  card: CardKind | null;
};

/** The address, the embed verdict and whether the card replaces the frame (handoff 7.3). */
export function frameModel(service: ServiceEntry, ctx: FrameContext): FrameModel {
  const url = frameUrl(service, ctx.mode, ctx.hostname);
  const embed = effectiveEmbed(service, ctx.protocol, url);
  let card: CardKind | null = null;
  if (url === null) card = ctx.mode === 'zone' ? 'home-only' : 'no-url';
  else if (embed.verdict === 'blocked') card = embed.reason ?? 'probe-failed';
  else if (ctx.alwaysNewTab) card = 'device';
  return { service, url, embed, card };
}

export type TabMark = 'loading' | 'blocked' | 'suspended';

/** The mark a tab carries instead of its health mark; null when nothing is wrong or pending. */
export function tabMark(model: FrameModel, live: boolean, loaded: boolean): TabMark | null {
  if (model.card !== null) return 'blocked';
  if (!live) return 'suspended';
  return loaded ? null : 'loading';
}
