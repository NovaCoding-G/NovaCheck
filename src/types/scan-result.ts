import type { ScanDiagnostics } from "./diagnostics.ts";
import type { Finding } from "./finding.ts";
import type { DetectorSkip } from "./scan-context.ts";

export interface ScanResult {
  /** 0–100 reliability score. Higher = safer to publish. */
  trustScore: number;
  findings: Finding[];
  /** Detector ids that produced a run (including empty result sets). */
  detectorsRun: string[];
  detectorsSkipped: DetectorSkip[];
  /** Per-detector file counts / patterns — used by --verbose. */
  diagnostics: ScanDiagnostics;
  scannedAt: string;
  rootDir: string;
  durationMs: number;
}
