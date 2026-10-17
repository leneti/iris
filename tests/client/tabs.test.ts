import { describe, expect, test } from 'vitest';
import {
  emptyTabs,
  loadTabs,
  saveTabs,
  tabHash,
  tabsReducer,
  type TabsState,
} from '@/lib/client/tabs';

function mem(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);
function openAll(list: string[], max?: number, from: TabsState = emptyTabs): TabsState {
  return list.reduce((s, id) => tabsReducer(s, { type: 'open', id, max }), from);
}

describe('tabsReducer', () => {
  test('opening focuses; reopening an open tab only focuses it', () => {
    let s = openAll(['a', 'b']);
    expect(s).toMatchObject({ open: ['a', 'b'], active: 'b', lru: ['b', 'a'], live: ['b', 'a'] });
    s = tabsReducer(s, { type: 'open', id: 'a' });
    expect(s.open).toEqual(['a', 'b']);
    expect(s.active).toBe('a');
    expect(s.lru).toEqual(['a', 'b']);
  });

  test('at most 8 live frames on desktop; the 9th open suspends the oldest', () => {
    const s = openAll(ids(9), 8);
    expect(s.open).toHaveLength(9);
    expect(s.live).toHaveLength(8);
    expect(s.live).not.toContain('s1');
    expect(s.live[0]).toBe('s9');
  });

  test('at most 3 live frames on phone', () => {
    const s = openAll(ids(5), 3);
    expect(s.live).toEqual(['s5', 's4', 's3']);
  });

  test('focusing a suspended tab makes it live and suspends the oldest live one', () => {
    let s = openAll(ids(4), 3); // live s4 s3 s2; s1 suspended
    expect(s.live).toEqual(['s4', 's3', 's2']);
    s = tabsReducer(s, { type: 'focus', id: 's1', max: 3 });
    expect(s.active).toBe('s1');
    expect(s.live).toEqual(['s1', 's4', 's3']);
    expect(s.open).toEqual(['s1', 's2', 's3', 's4']);
  });

  test('focusing a live tab keeps the same live set and reorders recency', () => {
    let s = openAll(ids(3), 3);
    s = tabsReducer(s, { type: 'focus', id: 's1', max: 3 });
    expect([...s.live].sort()).toEqual(['s1', 's2', 's3']);
    expect(s.lru[0]).toBe('s1');
  });

  test('focus on an unknown id does nothing', () => {
    const s = openAll(['a']);
    expect(tabsReducer(s, { type: 'focus', id: 'zzz' })).toEqual(s);
  });

  test('built-in tabs never take a live frame slot', () => {
    const s = openAll(['s1', 's2', 'builtin:jobs', 's3'], 3);
    expect(s.live).toEqual(['s3', 's2', 's1']);
    expect(s.open).toContain('builtin:jobs');
  });

  test('closing the active tab activates the most recently used remaining tab', () => {
    let s = openAll(['a', 'b', 'c']);
    s = tabsReducer(s, { type: 'focus', id: 'a' });
    s = tabsReducer(s, { type: 'focus', id: 'c' });
    s = tabsReducer(s, { type: 'close', id: 'c' });
    expect(s.open).toEqual(['a', 'b']);
    expect(s.active).toBe('a');
    expect(s.live).not.toContain('c');
    expect(s.lru).not.toContain('c');
  });

  test('closing an inactive tab keeps the active one; closing the last gives null', () => {
    let s = openAll(['a', 'b']);
    s = tabsReducer(s, { type: 'close', id: 'a' });
    expect(s.active).toBe('b');
    s = tabsReducer(s, { type: 'close', id: 'b' });
    expect(s).toEqual(emptyTabs);
  });

  test('closing a live tab does not wake a suspended one', () => {
    let s = openAll(ids(4), 3); // s1 suspended
    s = tabsReducer(s, { type: 'close', id: 's4', max: 3 });
    expect(s.live).toEqual(['s3', 's2']);
    expect(s.active).toBe('s3');
  });

  test('closeOthers keeps the given tab, closeAll empties', () => {
    const s = openAll(['a', 'b', 'c']);
    const o = tabsReducer(s, { type: 'closeOthers', id: 'a' });
    expect(o).toMatchObject({ open: ['a'], active: 'a', lru: ['a'], live: ['a'] });
    expect(tabsReducer(s, { type: 'closeAll' })).toEqual(emptyTabs);
  });

  test('the Overview is pinned: closing it changes nothing', () => {
    const s = openAll(['builtin:overview', 'a']);
    expect(tabsReducer(s, { type: 'close', id: 'builtin:overview' })).toBe(s);
  });

  test('setMaxLive trims the live set to the most recent', () => {
    const s = tabsReducer(openAll(ids(6), 8), { type: 'setMaxLive', max: 3 });
    expect(s.live).toEqual(['s6', 's5', 's4']);
    expect(s.open).toHaveLength(6);
  });
});

describe('loadTabs / saveTabs', () => {
  const known = new Set(['radarr', 'sonarr']);

  // Review Focus 4
  test('throwing or corrupt storage falls back to defaults', () => {
    const throwing = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceeded');
      },
    } as unknown as Storage;
    expect(loadTabs(throwing, '', new Set(['radarr']))).toEqual(emptyTabs);
    expect(loadTabs(mem({ 'iris.tabs': '{not json' }), '', new Set(['radarr']))).toEqual(emptyTabs);
    expect(loadTabs(null, '', known)).toEqual(emptyTabs);
  });

  test('wrong version or shape is ignored', () => {
    expect(
      loadTabs(
        mem({ 'iris.tabs': JSON.stringify({ v: 2, open: ['radarr'], active: 'radarr' }) }),
        '',
        known,
      ),
    ).toEqual(emptyTabs);
    expect(
      loadTabs(mem({ 'iris.tabs': JSON.stringify({ v: 1, open: 'radarr' }) }), '', known),
    ).toEqual(emptyTabs);
    expect(loadTabs(mem({ 'iris.tabs': 'null' }), '', known)).toEqual(emptyTabs);
  });

  test('unknown tab ids are dropped silently', () => {
    expect(
      loadTabs(
        mem({ 'iris.tabs': JSON.stringify({ v: 1, open: ['radarr', 'gone'], active: 'gone' }) }),
        '',
        new Set(['radarr']),
      ),
    ).toMatchObject({ open: ['radarr'], active: 'radarr' });
  });

  test('built-in ids are always known; duplicates are removed', () => {
    const s = loadTabs(
      mem({
        'iris.tabs': JSON.stringify({
          v: 1,
          open: ['builtin:jobs', 'radarr', 'radarr'],
          active: 'builtin:jobs',
        }),
      }),
      '',
      known,
    );
    expect(s.open).toEqual(['builtin:jobs', 'radarr']);
    expect(s.active).toBe('builtin:jobs');
  });

  test('only the active service tab starts live', () => {
    const s = loadTabs(
      mem({ 'iris.tabs': JSON.stringify({ v: 1, open: ['radarr', 'sonarr'], active: 'sonarr' }) }),
      '',
      known,
    );
    expect(s.live).toEqual(['sonarr']);
    expect(s.lru).toEqual(['sonarr', 'radarr']);
    const b = loadTabs(
      mem({
        'iris.tabs': JSON.stringify({
          v: 1,
          open: ['builtin:jobs', 'radarr'],
          active: 'builtin:jobs',
        }),
      }),
      '',
      known,
    );
    expect(b.live).toEqual([]);
  });

  test('the URL hash wins over storage for the active tab', () => {
    const storage = mem({
      'iris.tabs': JSON.stringify({ v: 1, open: ['radarr', 'sonarr'], active: 'radarr' }),
    });
    expect(loadTabs(storage, '#tab=sonarr', known)).toMatchObject({
      active: 'sonarr',
      open: ['radarr', 'sonarr'],
    });
    expect(loadTabs(storage, 'tab=sonarr', known).active).toBe('sonarr');
  });

  test('a hash tab that is not stored is opened; works with empty storage', () => {
    expect(loadTabs(mem(), '#tab=builtin%3Ajobs', known)).toMatchObject({
      open: ['builtin:jobs'],
      active: 'builtin:jobs',
    });
    expect(loadTabs(null, '#tab=radarr', known)).toMatchObject({
      open: ['radarr'],
      active: 'radarr',
      live: ['radarr'],
    });
  });

  test('an unknown or malformed hash is ignored', () => {
    const storage = mem({
      'iris.tabs': JSON.stringify({ v: 1, open: ['radarr'], active: 'radarr' }),
    });
    expect(loadTabs(storage, '#tab=gone', known).active).toBe('radarr');
    expect(loadTabs(storage, '#tab=%E0%A4%A', known).active).toBe('radarr');
    expect(loadTabs(storage, '#other', known).active).toBe('radarr');
  });

  test('saveTabs round-trips and never throws', () => {
    const storage = mem();
    const state = openAll(['radarr', 'sonarr']);
    saveTabs(storage, state);
    expect(JSON.parse(storage.getItem('iris.tabs')!)).toEqual({
      v: 1,
      open: ['radarr', 'sonarr'],
      active: 'sonarr',
    });
    expect(loadTabs(storage, '', known)).toMatchObject({
      open: ['radarr', 'sonarr'],
      active: 'sonarr',
    });
    const throwing = {
      setItem() {
        throw new Error('QuotaExceeded');
      },
    } as unknown as Storage;
    expect(() => saveTabs(throwing, state)).not.toThrow();
    expect(() => saveTabs(null, state)).not.toThrow();
  });

  test('tabHash', () => {
    expect(tabHash('radarr')).toBe('#tab=radarr');
    expect(tabHash('builtin:jobs')).toBe('#tab=builtin%3Ajobs');
    expect(tabHash(null)).toBe('');
  });
});
