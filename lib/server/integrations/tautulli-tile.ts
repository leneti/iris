import 'server-only';
import { getActivity, toStreams } from '../panels/tautulli';
import { IntegrationError, type Adapter } from './fetcher';

// The Plex tile (D1.12). Homepage's "Plex" is a Tautulli widget, so this adapter makes no call
// of its own: it reads the Now playing panel's `getActivity()`, which holds the one 15 s cache
// (criterion 11.12). The counts come from the same rows the panel lists, so they always agree.
export const adapter: Adapter = {
  type: 'tautulli',
  defaultFields: ['streams', 'transcodes'],
  extraFields: [],
  labels: { streams: 'Streams', transcodes: 'Transcoding' },
  credentials: (env) => (env.tautulliKey ? {} : null),
  async fetch() {
    const activity = await getActivity();
    if (activity.state === 'not-configured') throw new IntegrationError('unreachable');
    if (activity.state !== 'ok') throw new IntegrationError(activity.state);
    const streams = toStreams(activity, false);
    return { streams: streams.sessions.length, transcodes: streams.transcodeCount };
  },
};
