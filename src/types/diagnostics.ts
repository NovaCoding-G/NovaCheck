/**
 * Per-detector runtime stats for --verbose / --debug.
 */
export interface DetectorRunStats {
  detectorId: string;
  name: string;
  /** ran = executed analysis; skipped = intentionally no-op */
  status: "ran" | "skipped";
  skipReason?: string;
  /** Files discovered / handed to the detector as candidates. */
  filesReceived: number;
  /** Files actually parsed / analysed (after lang/filter gates). */
  filesAnalyzed: number;
  /** Globs / extension filters this detector uses. */
  discoveryPatterns: string[];
  findingsCount: number;
}

export interface ScanDiagnostics {
  detectors: DetectorRunStats[];
  /** Union of all filesReceived across detectors (may count same path twice). */
  totalFilesReceived: number;
  /** Unique absolute paths seen by any detector (best-effort). */
  uniqueFilesTouched: number;
  discoveryPatterns: string[];
}
