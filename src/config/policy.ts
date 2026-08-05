import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { computeTrustScore, sortFindings } from "../scoring/trust-score.ts";
import type { Finding, ScanResult, Severity } from "../types/index.ts";

const SEVERITIES = new Set<Severity>([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

export interface NovaCheckPolicy {
  minimumScore?: number;
  failOn?: Severity[];
  ignore?: {
    detectors?: string[];
    findings?: string[];
    paths?: string[];
  };
}

export interface LoadedPolicy {
  path?: string;
  policy: NovaCheckPolicy;
}

export async function loadPolicy(
  rootDir: string,
  explicitPath?: string,
): Promise<LoadedPolicy> {
  const candidates = explicitPath
    ? [resolve(explicitPath)]
    : [
        join(rootDir, ".novacheck.yml"),
        join(rootDir, ".novacheck.yaml"),
        join(rootDir, ".novacheck.json"),
      ];

  for (const path of candidates) {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = parse(raw) as unknown;
      return { path, policy: validatePolicy(parsed, path) };
    } catch (error) {
      if (isMissingFile(error)) continue;
      if (error instanceof Error && error.message.startsWith("Policy NovaCheck")) {
        throw error;
      }
      throw new Error(
        `Policy NovaCheck non valida (${path}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (explicitPath) {
    throw new Error(`Policy NovaCheck non trovata: ${resolve(explicitPath)}`);
  }
  return { policy: {} };
}

export function applyPolicy(
  result: ScanResult,
  policy: NovaCheckPolicy,
): ScanResult {
  const ignoredDetectors = new Set(policy.ignore?.detectors ?? []);
  const ignoredFindings = new Set(policy.ignore?.findings ?? []);
  const ignoredPaths = policy.ignore?.paths ?? [];
  const findings = sortFindings(
    result.findings.filter(
      (finding) =>
        !ignoredDetectors.has(finding.detectorId) &&
        !ignoredFindings.has(finding.id) &&
        !isIgnoredPath(finding.file, ignoredPaths),
    ),
  );
  const counts = countByDetector(findings);

  return {
    ...result,
    trustScore: computeTrustScore(findings),
    findings,
    diagnostics: {
      ...result.diagnostics,
      detectors: result.diagnostics.detectors.map((detector) => ({
        ...detector,
        findingsCount: counts.get(detector.detectorId) ?? 0,
      })),
    },
  };
}

export function policyFailureReasons(
  result: ScanResult,
  policy: NovaCheckPolicy,
  fallbackMinimumScore: number,
): string[] {
  const reasons: string[] = [];
  const minimumScore = policy.minimumScore ?? fallbackMinimumScore;
  if (result.trustScore < minimumScore) {
    reasons.push(
      `Trust Score ${result.trustScore}/100 sotto la soglia ${minimumScore}/100`,
    );
  }

  for (const severity of policy.failOn ?? []) {
    const count = result.findings.filter(
      (finding) => finding.severity === severity,
    ).length;
    if (count > 0) {
      reasons.push(`${count} finding con severità ${severity}`);
    }
  }
  return reasons;
}

function validatePolicy(value: unknown, path: string): NovaCheckPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Policy NovaCheck non valida (${path}): atteso un oggetto.`);
  }
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["minimumScore", "failOn", "ignore"]);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `Policy NovaCheck non valida (${path}): chiavi sconosciute: ${unknown.join(", ")}.`,
    );
  }

  const policy: NovaCheckPolicy = {};
  if (raw.minimumScore !== undefined) {
    if (
      typeof raw.minimumScore !== "number" ||
      !Number.isInteger(raw.minimumScore) ||
      raw.minimumScore < 0 ||
      raw.minimumScore > 100
    ) {
      throw new Error(
        `Policy NovaCheck non valida (${path}): minimumScore deve essere un intero 0-100.`,
      );
    }
    policy.minimumScore = raw.minimumScore;
  }
  if (raw.failOn !== undefined) {
    policy.failOn = stringArray(raw.failOn, "failOn", path) as Severity[];
    const invalid = policy.failOn.filter((item) => !SEVERITIES.has(item));
    if (invalid.length > 0) {
      throw new Error(
        `Policy NovaCheck non valida (${path}): severità sconosciute: ${invalid.join(", ")}.`,
      );
    }
  }
  if (raw.ignore !== undefined) {
    if (!raw.ignore || typeof raw.ignore !== "object" || Array.isArray(raw.ignore)) {
      throw new Error(
        `Policy NovaCheck non valida (${path}): ignore deve essere un oggetto.`,
      );
    }
    const ignore = raw.ignore as Record<string, unknown>;
    const unknownIgnore = Object.keys(ignore).filter(
      (key) =>
        key !== "detectors" && key !== "findings" && key !== "paths",
    );
    if (unknownIgnore.length > 0) {
      throw new Error(
        `Policy NovaCheck non valida (${path}): chiavi ignore sconosciute: ${unknownIgnore.join(", ")}.`,
      );
    }
    policy.ignore = {
      detectors:
        ignore.detectors === undefined
          ? undefined
          : stringArray(ignore.detectors, "ignore.detectors", path),
      findings:
        ignore.findings === undefined
          ? undefined
          : stringArray(ignore.findings, "ignore.findings", path),
      paths:
        ignore.paths === undefined
          ? undefined
          : stringArray(ignore.paths, "ignore.paths", path),
    };
  }
  return policy;
}

function stringArray(value: unknown, name: string, path: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error(
      `Policy NovaCheck non valida (${path}): ${name} deve essere una lista di stringhe.`,
    );
  }
  return value;
}

function countByDetector(findings: Finding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(
      finding.detectorId,
      (counts.get(finding.detectorId) ?? 0) + 1,
    );
  }
  return counts;
}

function isIgnoredPath(
  file: string | undefined,
  patterns: readonly string[],
): boolean {
  if (!file) return false;
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  let source = "^";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i]!;
    if (char === "*" && normalized[i + 1] === "*") {
      source += ".*";
      i++;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
