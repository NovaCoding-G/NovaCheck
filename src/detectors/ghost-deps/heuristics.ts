/** Levenshtein edit distance — used for typosquat / slopsquat similarity. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j] ?? 0;
  }

  return prev[b.length] ?? 0;
}

/**
 * Max edit distance we consider "suspiciously similar".
 * Short names are strict (distance 1); longer names allow 2.
 */
export function similarDistanceThreshold(name: string): number {
  return name.length >= 6 ? 2 : 1;
}

export function daysSince(date: Date, now = new Date()): number {
  const ms = now.getTime() - date.getTime();
  return ms / (1000 * 60 * 60 * 24);
}

export function normalizePackageName(name: string, ecosystem: "npm" | "pypi"): string {
  const trimmed = name.trim();
  if (ecosystem === "pypi") {
    // PEP 503 normalization
    return trimmed.toLowerCase().replace(/[-_.]+/g, "-");
  }
  // npm is case-sensitive for scopes but registry lookups are lowercase
  return trimmed.toLowerCase();
}
