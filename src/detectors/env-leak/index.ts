import type { Detector, Finding, ScanContext } from "../../types/index.ts";
import { runEnvLeakScan } from "./scan.ts";

export { runEnvLeakScan } from "./scan.ts";

export function createEnvLeakDetector(): Detector {
  return {
    id: "env-leak",
    name: ".env / secret file exposure",
    description:
      "Detects unprotected .env files or files already tracked by Git; secret values are handled by the secrets detector.",
    async run(ctx: ScanContext): Promise<Finding[]> {
      const result = await runEnvLeakScan(ctx.rootDir);
      ctx.recordStats({
        detectorId: "env-leak",
        name: ".env / secret file exposure",
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

export const envLeakDetector = createEnvLeakDetector();
