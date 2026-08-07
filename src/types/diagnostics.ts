/**
 * Per-detector runtime stats for --verbose / --debug.
 */
export interface ScanDiagnosticIssue {
  detectorId: string;
  /** Stable machine-readable code (for example registry-lookup-failed). */
  code: string;
  /** Human-readable explanation without secret values. */
  message: string;
  /** Optional project-relative file affected by the incomplete analysis. */
  file?: string;
}

export interface DetectorRunStats {
  detectorId: string;
  name: string;
  /** degraded = analysis ran, but one or more inputs could not be checked. */
  status: "ran" | "skipped" | "degraded";
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
  /** True when at least one candidate could not be analyzed completely. */
  incomplete: boolean;
  issues: ScanDiagnosticIssue[];
  /** Union of all filesReceived across detectors (may count same path twice). */
  totalFilesReceived: number;
  /** Unique absolute paths seen by any detector (best-effort). */
  uniqueFilesTouched: number;
  discoveryPatterns: string[];
}
