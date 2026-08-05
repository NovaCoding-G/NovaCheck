import type { Finding } from "../../types/index.ts";
import { loadAgentTrace } from "./agent-trace.ts";
import { findingsFromAttributions } from "./analyze.ts";
import { loadSpdxAiDisclosure } from "./spdx-disclosure.ts";
import type { ProvenanceBundle } from "./types.ts";

export const AI_UNREVIEWED_DISCOVERY_PATTERNS = [
  ".agent-trace/traces.jsonl",
  ".agent-trace/*.json (Agent Trace records)",
  "source headers: SPDX-AI-Disclosure: ai-generated (via text-file walk)",
] as const;

export async function loadProvenance(rootDir: string): Promise<ProvenanceBundle> {
  const [agent, spdx] = await Promise.all([
    loadAgentTrace(rootDir),
    loadSpdxAiDisclosure(rootDir),
  ]);

  const sources = [...agent.sources, ...spdx.sources];
  const files = [...agent.attributions, ...spdx.attributions];

  return {
    found: sources.length > 0,
    sources,
    files,
  };
}

export async function runAiUnreviewedScan(rootDir: string): Promise<{
  findings: Finding[];
  skipped?: string;
  provenanceSources: string[];
  filesReceived: number;
  filesAnalyzed: number;
  files: string[];
  discoveryPatterns: string[];
}> {
  const bundle = await loadProvenance(rootDir);
  const files = [
    ...new Set([
      ...bundle.sources.map((s) => s),
      ...bundle.files.map((f) => f.file),
    ]),
  ];

  if (!bundle.found) {
    return {
      findings: [],
      skipped:
        "Nessuna provenance riconosciuta (Agent Trace / SPDX-AI-Disclosure). Modulo saltato.",
      provenanceSources: [],
      filesReceived: 0,
      filesAnalyzed: 0,
      files: [],
      discoveryPatterns: [...AI_UNREVIEWED_DISCOVERY_PATTERNS],
    };
  }

  const findings = findingsFromAttributions(bundle.files, bundle.sources);
  return {
    findings,
    provenanceSources: bundle.sources,
    filesReceived: files.length,
    filesAnalyzed: bundle.files.length,
    files,
    discoveryPatterns: [...AI_UNREVIEWED_DISCOVERY_PATTERNS],
  };
}
