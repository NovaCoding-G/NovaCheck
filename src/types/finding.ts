import type { Severity } from "./severity.ts";

/** Single issue reported by a detector. */
export interface Finding {
  /** Stable id within a detector, e.g. "ghost-deps:nonexistent:npm:left-padx". */
  id: string;
  detectorId: string;
  severity: Severity;
  title: string;
  /** Risk explanation for reports. */
  explanation: string;
  /** Pasteable remediation prompt for an AI coding agent. */
  fixPrompt: string;
  /** Path relative to the scanned project root, when applicable. */
  file?: string;
  line?: number;
  column?: number;
  /** Short snippet or package name that triggered the finding. */
  evidence?: string;
  metadata?: Record<string, unknown>;
}
