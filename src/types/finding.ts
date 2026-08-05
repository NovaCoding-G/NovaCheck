import type { Severity } from "./severity.ts";

/**
 * A single, self-explaining issue reported by a detector.
 * Precision over volume: every Finding must stand alone without extra context.
 */
export interface Finding {
  /** Stable id within a detector, e.g. "ghost-deps:nonexistent:npm:left-padx". */
  id: string;
  detectorId: string;
  severity: Severity;
  /** Short human label shown in lists. */
  title: string;
  /** Why this is a risk — shown to the user, not an internal note. */
  explanation: string;
  /** Ready-to-paste prompt for an AI coding agent to fix the issue. */
  fixPrompt: string;
  /** Path relative to the scanned project root, when applicable. */
  file?: string;
  line?: number;
  column?: number;
  /** Short snippet or package name that triggered the finding. */
  evidence?: string;
  metadata?: Record<string, unknown>;
}
