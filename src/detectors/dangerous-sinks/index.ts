import type { Detector, Finding, ScanContext } from "../../types/index.ts";
import { runDangerousSinksScan } from "./scan.ts";

export { runDangerousSinksScan, analyzeSource } from "./scan.ts";
export { langForFile, initTreeSitter } from "./parser.ts";

export function createDangerousSinksDetector(): Detector {
  return {
    id: "dangerous-sinks",
    name: "Sink pericolosi",
    description:
      "Rileva shell/SQL injection, CORS *, TLS off, eval/Function, XSS (innerHTML), pickle/yaml.load (AST tree-sitter).",
    async run(ctx: ScanContext): Promise<Finding[]> {
      const result = await runDangerousSinksScan(ctx.rootDir);
      ctx.recordStats({
        detectorId: "dangerous-sinks",
        name: "Sink pericolosi",
        filesReceived: result.filesReceived,
        filesAnalyzed: result.filesAnalyzed,
        discoveryPatterns: result.discoveryPatterns,
        files: result.files,
        findingsCount: result.findings.length,
      });
      return result.findings;
    },
  };
}

export const dangerousSinksDetector = createDangerousSinksDetector();
