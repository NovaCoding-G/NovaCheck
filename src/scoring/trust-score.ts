import type { Finding, Severity } from "../types/index.ts";
import { SEVERITY_ORDER, SEVERITY_WEIGHT } from "../types/index.ts";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Trust Score 0–100: start at 100, subtract severity weights, clamp.
 * Multiple findings of the same severity all count (publishing risk stacks).
 */
export function computeTrustScore(findings: Finding[]): number {
  let score = 100;
  for (const f of findings) {
    score -= SEVERITY_WEIGHT[f.severity] ?? 0;
  }
  return Math.max(0, Math.min(100, score));
}

/** Sort by severity (critical first), then file/line for stability. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sr = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sr !== 0) return sr;
    const fa = a.file ?? "";
    const fb = b.file ?? "";
    if (fa !== fb) return fa.localeCompare(fb);
    return (a.line ?? 0) - (b.line ?? 0);
  });
}

export function topPriorityFindings(
  findings: Finding[],
  limit = 5,
): Finding[] {
  return sortFindings(findings).slice(0, limit);
}

export function countBySeverity(
  findings: Finding[],
): Record<Severity, number> {
  const counts = Object.fromEntries(
    SEVERITY_ORDER.map((s) => [s, 0]),
  ) as Record<Severity, number>;
  for (const f of findings) {
    counts[f.severity] += 1;
  }
  return counts;
}

/** Label + color hint for badges / terminal. */
export function scoreBand(score: number): {
  label: string;
  color: string;
  /** shields.io color name */
  shields: string;
} {
  if (score >= 90) return { label: "eccellente", color: "green", shields: "brightgreen" };
  if (score >= 70) return { label: "buono", color: "green", shields: "green" };
  if (score >= 50) return { label: "discreto", color: "yellow", shields: "yellow" };
  if (score >= 30) return { label: "scarso", color: "orange", shields: "orange" };
  return { label: "critico", color: "red", shields: "red" };
}
