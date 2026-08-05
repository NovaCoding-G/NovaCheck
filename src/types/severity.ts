/** Severity ordered from most to least urgent for Trust Score weighting. */
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITY_ORDER: readonly Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 2,
  info: 0,
};
