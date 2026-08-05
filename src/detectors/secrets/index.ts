import type { Detector, Finding, ScanContext } from "../../types/index.ts";
import { runSecretsScan, type SecretsScanOptions } from "./scan.ts";

export type { SecretsScanOptions, SecretsScanResult } from "./scan.ts";
export { runSecretsScan } from "./scan.ts";
export { findEntropySecrets, shannonEntropy, maskSecret } from "./entropy.ts";
export { lintContentWithSecretlint } from "./secretlint-runner.ts";

export interface SecretsDetectorOptions extends SecretsScanOptions {}

export function createSecretsDetector(
  options: SecretsDetectorOptions = {},
): Detector {
  return {
    id: "secrets",
    name: "Segreti hardcoded",
    description:
      "Trova API key, token, password e connection string in chiaro (secretlint + entropia contestuale).",
    async run(ctx: ScanContext): Promise<Finding[]> {
      const result = await runSecretsScan(ctx.rootDir, options);
      ctx.recordStats({
        detectorId: "secrets",
        name: "Segreti hardcoded",
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

export const secretsDetector = createSecretsDetector();
