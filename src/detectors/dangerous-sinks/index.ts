import type { Detector, Finding, ScanContext } from "../../types/index.ts";
import { runDangerousSinksScan } from "./scan.ts";

export { runDangerousSinksScan, analyzeSource } from "./scan.ts";
export { langForFile, initTreeSitter } from "./parser.ts";

export function createDangerousSinksDetector(): Detector {
  return {
    id: "dangerous-sinks",
    name: "Dangerous sinks",
    description:
      "Detects shell/SQL injection, permissive CORS, disabled TLS, eval/Function, XSS, and unsafe pickle/yaml.load using tree-sitter ASTs.",
    async run(ctx: ScanContext): Promise<Finding[]> {
      const result = await runDangerousSinksScan(ctx.rootDir, {
        onIssue: (issue) =>
          ctx.reportIssue({
            detectorId: "dangerous-sinks",
            ...issue,
          }),
      });
      ctx.recordStats({
        detectorId: "dangerous-sinks",
        name: "Dangerous sinks",
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
