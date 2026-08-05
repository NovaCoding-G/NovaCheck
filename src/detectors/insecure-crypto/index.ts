import type { Detector, Finding, ScanContext } from "../../types/index.ts";
import { runInsecureCryptoScan } from "./scan.ts";

export { runInsecureCryptoScan } from "./scan.ts";

export function createInsecureCryptoDetector(): Detector {
  return {
    id: "insecure-crypto",
    name: "Insecure cryptography / randomness",
    description:
      "MD5/SHA1, deprecated createCipher, and Math.random/random used for tokens or secrets.",
    async run(ctx: ScanContext): Promise<Finding[]> {
      const result = await runInsecureCryptoScan(ctx.rootDir);
      ctx.recordStats({
        detectorId: "insecure-crypto",
        name: "Insecure cryptography / randomness",
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

export const insecureCryptoDetector = createInsecureCryptoDetector();
