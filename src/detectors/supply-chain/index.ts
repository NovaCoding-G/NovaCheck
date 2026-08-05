import type { Detector, Finding, ScanContext } from "../../types/index.ts";
import { runSupplyChainScan } from "./scan.ts";

export { runSupplyChainScan } from "./scan.ts";

export function createSupplyChainDetector(): Detector {
  return {
    id: "supply-chain",
    name: "Supply chain / dangerous scripts",
    description:
      "Suspicious npm lifecycle scripts such as curl|bash and Git dependencies over unencrypted HTTP.",
    async run(ctx: ScanContext): Promise<Finding[]> {
      const result = await runSupplyChainScan(ctx.rootDir);
      ctx.recordStats({
        detectorId: "supply-chain",
        name: "Supply chain / dangerous scripts",
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

export const supplyChainDetector = createSupplyChainDetector();
