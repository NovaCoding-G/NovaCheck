export type ContributorType = "human" | "ai" | "mixed" | "unknown";

export interface LineRange {
  start: number;
  end: number;
}

export interface AttributedRange extends LineRange {
  contributor: ContributorType;
  modelId?: string;
  source: "agent-trace" | "spdx-ai-disclosure";
  /** Trace / record id when available. */
  traceId?: string;
}

export interface FileAttribution {
  file: string;
  ranges: AttributedRange[];
}

export interface ProvenanceBundle {
  /** True when at least one recognized provenance source was found. */
  found: boolean;
  sources: string[];
  files: FileAttribution[];
}
