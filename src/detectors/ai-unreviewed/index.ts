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
    name: "Unreviewed AI-authored lines",
    description:
      "Uses existing provenance (Agent Trace, SPDX-AI-Disclosure) to identify AI-authored code never touched by a human. Skips when provenance is absent.",
    async run(ctx: ScanContext): Promise<Finding[]> {
      const result = await runAiUnreviewedScan(ctx.rootDir);
      ctx.recordStats({
        detectorId: "ai-unreviewed",
        name: "Unreviewed AI-authored lines",
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
