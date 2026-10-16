/**
 * Palette ranking. 1 is a field that starts with the query, then a field that contains it, then
 * the query's letters in order but not adjacent ("rdr" for "radarr"), kept within a short span
 * so long text does not match by accident. 0 means no match. A field other than the name counts
 * a little less, so a name match ranks first.
 */
const NAME = 1;
const OTHER = 0.8;

function fieldScore(field: string, q: string): number {
  const text = field.toLowerCase();
  if (text.startsWith(q)) return 1;
  if (text.includes(q)) return 0.9;
  let best = 0;
  for (let from = text.indexOf(q[0]!); from !== -1; from = text.indexOf(q[0]!, from + 1)) {
    let at = from;
    let ok = true;
    for (let i = 1; i < q.length && ok; i += 1) {
      at = text.indexOf(q[i]!, at + 1);
      ok = at !== -1;
    }
    const span = at - from + 1;
    if (ok && span <= q.length * 3) best = Math.max(best, (0.5 * q.length) / span);
  }
  return best;
}

/** The `filter` for cmdk. The value is a unique id and is ignored; `keywords[0]` is the name. */
export function scoreEntry(_value: string, search: string, keywords: string[] = []): number {
  const q = search.trim().toLowerCase();
  if (q === '') return 1;
  let best = 0;
  keywords.forEach((field, i) => {
    if (field !== '') best = Math.max(best, fieldScore(field, q) * (i === 0 ? NAME : OTHER));
  });
  return best;
}
