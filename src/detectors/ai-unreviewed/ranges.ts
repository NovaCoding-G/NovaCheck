import type { LineRange } from "./types.ts";

/** Merge overlapping/adjacent ranges. */
export function mergeRanges(ranges: LineRange[]): LineRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: LineRange[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.start <= last.end + 1) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** Subtract `cut` ranges from `base` (all 1-indexed inclusive). */
export function subtractRanges(base: LineRange[], cut: LineRange[]): LineRange[] {
  const cuts = mergeRanges(cut);
  let remaining = mergeRanges(base);
  for (const c of cuts) {
    const next: LineRange[] = [];
    for (const r of remaining) {
      if (c.end < r.start || c.start > r.end) {
        next.push(r);
        continue;
      }
      if (c.start > r.start) {
        next.push({ start: r.start, end: Math.min(r.end, c.start - 1) });
      }
      if (c.end < r.end) {
        next.push({ start: Math.max(r.start, c.end + 1), end: r.end });
      }
    }
    remaining = next;
  }
  return remaining.filter((r) => r.start <= r.end);
}

export function rangeLineCount(ranges: LineRange[]): number {
  return ranges.reduce((n, r) => n + (r.end - r.start + 1), 0);
}

export function formatRanges(ranges: LineRange[]): string {
  return ranges.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`)).join(", ");
}
