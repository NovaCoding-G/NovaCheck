import type { Detector, Finding, ScanContext } from "../../types/index.ts";
import { runAiUnreviewedScan } from "./scan.ts";

export { runAiUnreviewedScan, loadProvenance } from "./scan.ts";
export {
  parseAgentTraceJsonl,
  parseAgentTraceRecord,
} from "./agent-trace.ts";
export {
  findingsFromAttributions,
  unreviewedRangesForFile,
  mergeFileAttributions,
} from "./analyze.ts";
export { mergeRanges, subtractRanges, rangeLineCount } from "./ranges.ts";

export function createAiUnreviewedDetector(): Detector {
  return {
    id: "ai-unreviewed",
    name: "Righe AI non riviste",
    description:
      "Usa provenance esistente (Agent Trace, SPDX-AI-Disclosure) per evidenziare codice AI mai toccato da un umano. Se manca, salta.",
    async run(ctx: ScanContext): Promise<Finding[]> {
      const result = await runAiUnreviewedScan(ctx.rootDir);
      ctx.recordStats({
        detectorId: "ai-unreviewed",
        name: "Righe AI non riviste",
        filesReceived: result.filesReceived,
        filesAnalyzed: result.filesAnalyzed,
        discoveryPatterns: result.discoveryPatterns,
        files: result.files,
        findingsCount: result.findings.length,
      });
      if (result.skipped) {
        ctx.skip("ai-unreviewed", result.skipped);
        return [];
      }
      return result.findings;
    },
  };
}

export const aiUnreviewedDetector = createAiUnreviewedDetector();
