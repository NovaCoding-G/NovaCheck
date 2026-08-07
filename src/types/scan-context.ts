import type {
  DetectorRunStats,
  ScanDiagnosticIssue,
} from "./diagnostics.ts";

export interface DetectorSkip {
  id: string;
  reason: string;
}

/**
 * Shared runtime context passed to every detector.
 * Network access (registry lookups) goes through injected clients so tests stay offline.
 */
export interface ScanContext {
  /** Absolute path of the project being scanned. */
  rootDir: string;
  /** Absolute path for durable local caches (registry responses, etc.). */
  cacheDir: string;
  /**
   * When true, registry clients must not hit the network —
   * cache hits only; misses are treated as "unknown" (no finding).
   */
  offline: boolean;
  signal?: AbortSignal;
  /** Detectors call this when they intentionally skip (not an error). */
  skip(detectorId: string, reason: string): void;
  /** Record an input that could not be analyzed completely. */
  reportIssue(issue: ScanDiagnosticIssue): void;
  /**
   * Detectors report discovery/analysis counts for --verbose.
   * Call once per detector run (after work completes).
   */
  recordStats(
    stats: Omit<DetectorRunStats, "status" | "skipReason" | "findingsCount"> & {
      findingsCount?: number;
      files?: string[];
    },
  ): void;
}
