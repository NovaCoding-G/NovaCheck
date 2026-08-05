/**
 * Conservative entropy pass: only flag high-entropy values bound to
 * secret-looking names. Avoids the classic "any UUID is a secret" trap.
 */

const SECRET_NAME_RE =
  /(?:^|[\s.{,])((?:api[_-]?key|access[_-]?key|secret(?:[_-]?key)?|passwd|password|auth[_-]?token|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret|credentials?))\s*[:=]\s*["'`]([A-Za-z0-9+/=_\-.]{20,})["'`]/gi;

const PLACEHOLDER_RE =
  /^(?:your[_-]?|my[_-]?|xxx+|placeholder|changeme|example|sample|dummy|test|todo|fixme|insert|replace|<.*>|\$\{.*\}|process\.env)/i;

export interface EntropyHit {
  name: string;
  value: string;
  line: number;
  column: number;
  entropy: number;
}

/** Shannon entropy in bits/char over observed alphabet. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let h = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function isPlaceholderSecret(value: string): boolean {
  if (PLACEHOLDER_RE.test(value)) return true;
  // Repeated chars / low variety
  if (new Set(value).size < 6) return true;
  return false;
}

/**
 * Find high-entropy assignments to secret-like identifiers.
 * Thresholds tuned for precision (few FPs on normal config strings).
 */
export function findEntropySecrets(
  content: string,
  options: { minLength?: number; minEntropy?: number } = {},
): EntropyHit[] {
  const minLength = options.minLength ?? 24;
  const minEntropy = options.minEntropy ?? 4.2;
  const hits: EntropyHit[] = [];
  const re = new RegExp(SECRET_NAME_RE.source, "gi");
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    const name = match[1] ?? "";
    const value = match[2] ?? "";
    if (value.length < minLength) continue;
    if (isPlaceholderSecret(value)) continue;
    const entropy = shannonEntropy(value);
    if (entropy < minEntropy) continue;

    const before = content.slice(0, match.index);
    const line = before.split(/\r?\n/).length;
    const lastNl = before.lastIndexOf("\n");
    const column = match.index - lastNl;

    hits.push({ name, value, line, column, entropy });
  }

  return hits;
}

/** Mask for evidence — never echo the full secret. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
