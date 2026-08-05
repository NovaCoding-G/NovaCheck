import { readFile } from "node:fs/promises";
import type { Finding } from "../../types/index.ts";
import { findEntropySecrets } from "./entropy.ts";
import { findingFromEntropy, findingFromSecretlint } from "./map-finding.ts";
import { lintFileWithSecretlint } from "./secretlint-runner.ts";
import {
  listTextFiles,
  TEXT_FILE_DISCOVERY_PATTERNS,
  toRel,
} from "./walk.ts";

export interface SecretsScanOptions {
  /** Skip the entropy pass (secretlint only). */
  skipEntropy?: boolean;
  maxFileBytes?: number;
}

export interface SecretsScanResult {
  findings: Finding[];
  filesReceived: number;
  filesAnalyzed: number;
  files: string[];
  discoveryPatterns: string[];
}

/**
 * Scan a project for hardcoded secrets.
 * Primary engine: secretlint recommend preset (mature patterns).
 * Secondary: conservative entropy on secret-named assignments.
 */
export async function runSecretsScan(
  rootDir: string,
  options: SecretsScanOptions = {},
): Promise<SecretsScanResult> {
  const files = await listTextFiles(rootDir, options.maxFileBytes);
  const findings: Finding[] = [];
  const occupiedLines = new Set<string>();
  let filesAnalyzed = 0;

  for (const abs of files) {
    const rel = toRel(rootDir, abs);
    let analyzed = false;

    let secretlintHits;
    try {
      secretlintHits = await lintFileWithSecretlint(abs);
      analyzed = true;
    } catch {
      continue;
    }

    for (const hit of secretlintHits) {
      occupiedLines.add(`${rel}:${hit.line}`);
      findings.push(findingFromSecretlint(hit, rel));
    }

    if (!options.skipEntropy) {
      let content: string;
      try {
        content = await readFile(abs, "utf8");
        analyzed = true;
      } catch {
        if (analyzed) filesAnalyzed++;
        continue;
      }

      for (const hit of findEntropySecrets(content)) {
        const key = `${rel}:${hit.line}`;
        if (occupiedLines.has(key)) continue;
        occupiedLines.add(key);
        findings.push(findingFromEntropy(hit, rel));
      }
    }

    if (analyzed) filesAnalyzed++;
  }

  return {
    findings,
    filesReceived: files.length,
    filesAnalyzed,
    files,
    discoveryPatterns: [...TEXT_FILE_DISCOVERY_PATTERNS],
  };
}
