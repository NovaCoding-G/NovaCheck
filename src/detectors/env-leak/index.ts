import type { Detector, Finding, ScanContext } from "../../types/index.ts";
import { runEnvLeakScan } from "./scan.ts";

export { runEnvLeakScan } from "./scan.ts";

export function createEnvLeakDetector(): Detector {
  return {
    id: "env-leak",
    name: "Leak di .env / secret files",
    description:
      "Rileva file .env non protetti o già tracciati da Git; i valori segreti sono gestiti dal detector secrets.",
    async run(ctx: ScanContext): Promise<Finding[]> {
      const result = await runEnvLeakScan(ctx.rootDir);
      ctx.recordStats({
        detectorId: "env-leak",
        name: "Leak di .env / secret files",
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
