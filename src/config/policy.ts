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
  /** Fail the policy when one or more inputs could not be analyzed. */
  failOnIncomplete?: boolean;
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
      if (error instanceof Error && error.message.startsWith("Invalid NovaCheck policy")) {
        throw error;
      }
      throw new Error(
        `Invalid NovaCheck policy (${path}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (explicitPath) {
    throw new Error(`NovaCheck policy not found: ${resolve(explicitPath)}`);
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
  const issues = result.diagnostics.issues.filter(
    (issue) =>
      !ignoredDetectors.has(issue.detectorId) &&
      !isIgnoredPath(issue.file, ignoredPaths),
  );
  const degradedDetectors = new Set(issues.map((issue) => issue.detectorId));

  return {
    ...result,
    trustScore: computeTrustScore(findings),
    findings,
    diagnostics: {
      ...result.diagnostics,
      incomplete: issues.length > 0,
      issues,
      detectors: result.diagnostics.detectors.map((detector) => ({
        ...detector,
        status:
          detector.status === "degraded" &&
          !degradedDetectors.has(detector.detectorId)
            ? "ran"
            : detector.status,
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
      `Trust Score ${result.trustScore}/100 is below the ${minimumScore}/100 threshold`,
    );
  }

  for (const severity of policy.failOn ?? []) {
    const count = result.findings.filter(
      (finding) => finding.severity === severity,
    ).length;
    if (count > 0) {
      reasons.push(`${count} ${severity}-severity ${count === 1 ? "finding" : "findings"}`);
    }
  }
  if (policy.failOnIncomplete && result.diagnostics.incomplete) {
    reasons.push(
      `Scan incomplete: ${result.diagnostics.issues.length} ${result.diagnostics.issues.length === 1 ? "input could" : "inputs could"} not be analyzed`,
    );
  }
  return reasons;
}

function validatePolicy(value: unknown, path: string): NovaCheckPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid NovaCheck policy (${path}): expected an object.`);
  }
  const raw = value as Record<string, unknown>;
  const allowed = new Set([
    "minimumScore",
    "failOn",
    "failOnIncomplete",
    "ignore",
  ]);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `Invalid NovaCheck policy (${path}): unknown keys: ${unknown.join(", ")}.`,
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
        `Invalid NovaCheck policy (${path}): minimumScore must be an integer from 0 to 100.`,
      );
    }
    policy.minimumScore = raw.minimumScore;
  }
  if (raw.failOn !== undefined) {
    policy.failOn = stringArray(raw.failOn, "failOn", path) as Severity[];
    const invalid = policy.failOn.filter((item) => !SEVERITIES.has(item));
    if (invalid.length > 0) {
      throw new Error(
        `Invalid NovaCheck policy (${path}): unknown severities: ${invalid.join(", ")}.`,
      );
    }
  }
  if (raw.failOnIncomplete !== undefined) {
    if (typeof raw.failOnIncomplete !== "boolean") {
      throw new Error(
        `Invalid NovaCheck policy (${path}): failOnIncomplete must be a boolean.`,
      );
    }
    policy.failOnIncomplete = raw.failOnIncomplete;
  }
  if (raw.ignore !== undefined) {
    if (!raw.ignore || typeof raw.ignore !== "object" || Array.isArray(raw.ignore)) {
      throw new Error(
        `Invalid NovaCheck policy (${path}): ignore must be an object.`,
      );
    }
    const ignore = raw.ignore as Record<string, unknown>;
    const unknownIgnore = Object.keys(ignore).filter(
      (key) =>
        key !== "detectors" && key !== "findings" && key !== "paths",
    );
    if (unknownIgnore.length > 0) {
      throw new Error(
        `Invalid NovaCheck policy (${path}): unknown ignore keys: ${unknownIgnore.join(", ")}.`,
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
      `Invalid NovaCheck policy (${path}): ${name} must be a list of strings.`,
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
