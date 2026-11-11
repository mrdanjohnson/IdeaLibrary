const STOP = new Set(
  'a an and are as at be but by for from has have i in into is it its of on or our that the their this to we with would should could more new idea ideas'.split(' '),
);

export function tokens(text) {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, '')),
  );
}

/** Ranks candidates by word overlap with `query`. Good enough for a church-sized library. */
export function similar(query, candidates, limit = 5) {
  const q = tokens(query);
  if (!q.size) return [];
  return candidates
    .map((c) => {
      const t = tokens(`${c.title} ${c.title} ${c.description.slice(0, 300)}`);
      let overlap = 0;
      for (const w of q) if (t.has(w)) overlap++;
      return { ...c, score: overlap / q.size };
    })
    .filter((c) => c.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
