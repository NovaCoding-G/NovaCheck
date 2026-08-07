import type { Finding, ScanResult, Severity } from "../types/index.ts";
import { VERSION } from "../version.ts";

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  help: { text: string; markdown: string };
  properties: { tags: string[]; defaultSeverity: Severity };
}

export interface SarifReportOptions {
  policyFailures?: string[];
  minimumScore?: number;
  failOn?: Severity[];
  scope?: {
    mode: "full" | "changed";
    base?: string;
    filesCount?: number;
  };
}

/**
 * GitHub Code Scanning requires every SARIF result to include at least one
 * physical location. Findings without a file (e.g. git-trailer AI signals)
 * stay in run properties instead of `results`.
 */
export function formatSarifReport(
  result: ScanResult,
  options: SarifReportOptions = {},
): string {
  const locatable: Finding[] = [];
  const informationalSignals: Finding[] = [];
  for (const finding of result.findings) {
    if (hasLocatableFile(finding)) locatable.push(finding);
    else informationalSignals.push(finding);
  }

  const rules = collectRules(locatable);
  const policyFailures = options.policyFailures ?? [];
  const policyPassed = policyFailures.length === 0;
  const report = {
    $schema:
      "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "NovaCheck",
            informationUri: "https://github.com/NovaCoding-G/NovaCheck",
            semanticVersion: VERSION,
            rules: [...rules.values()],
          },
        },
        automationDetails: { id: "novacheck/security-and-ai-trust" },
        invocations: [
          {
            executionSuccessful: true,
            endTimeUtc: result.scannedAt,
            properties: {
              trustScore: result.trustScore,
              durationMs: result.durationMs,
              policyPassed,
              policyFailures,
            },
          },
        ],
        results: locatable.map((finding) =>
          findingToSarif(finding, ruleIdFor(finding)),
        ),
        properties: {
          trustScore: result.trustScore,
          scannedRoot: result.rootDir,
          detectorsRun: result.detectorsRun,
          detectorsSkipped: result.detectorsSkipped,
          policyPassed,
          policyFailures,
          minimumScore: options.minimumScore,
          failOn: options.failOn ?? [],
          scope: options.scope ?? { mode: "full" },
          informationalSignals: informationalSignals.map(
            summarizeInformationalSignal,
          ),
        },
      },
    ],
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

function hasLocatableFile(finding: Finding): boolean {
  return typeof finding.file === "string" && finding.file.trim().length > 0;
}

function summarizeInformationalSignal(finding: Finding): Record<string, unknown> {
  return {
    id: finding.id,
    detectorId: finding.detectorId,
    severity: finding.severity,
    title: finding.title,
    ...(finding.evidence ? { evidence: finding.evidence } : {}),
    ...(finding.metadata ? { metadata: finding.metadata } : {}),
  };
}

function collectRules(findings: Finding[]): Map<string, SarifRule> {
  const rules = new Map<string, SarifRule>();
  for (const finding of findings) {
    const id = ruleIdFor(finding);
    if (rules.has(id)) continue;
    rules.set(id, {
      id,
      name: sanitizeName(id),
      shortDescription: { text: finding.title },
      help: {
        text: `${finding.explanation}\n\nFix: ${finding.fixPrompt}`,
        markdown: `${finding.explanation}\n\n**Fix:** ${finding.fixPrompt}`,
      },
      properties: {
        tags: ["security", "ai-generated-code", finding.detectorId],
        defaultSeverity: finding.severity,
      },
    });
  }
  return rules;
}

function findingToSarif(finding: Finding, ruleId: string): object {
  const file = finding.file!.replaceAll("\\", "/");
  return {
    ruleId,
    level: sarifLevel(finding.severity),
    message: {
      text: `${finding.title}. ${finding.explanation}`,
    },
    partialFingerprints: {
      novacheckFindingId: finding.id,
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: file,
            uriBaseId: "%SRCROOT%",
          },
          region: {
            startLine: Math.max(1, finding.line ?? 1),
            startColumn: Math.max(1, finding.column ?? 1),
          },
        },
      },
    ],
    properties: {
      severity: finding.severity,
      detectorId: finding.detectorId,
      fixPrompt: finding.fixPrompt,
      ...(finding.evidence ? { evidence: finding.evidence } : {}),
    },
  };
}

function ruleIdFor(finding: Finding): string {
  const metadataRule = finding.metadata?.ruleId;
  const suffix =
    typeof metadataRule === "string" && metadataRule.length > 0
      ? metadataRule
      : finding.id.split(":").slice(0, 2).join(":");
  return `${finding.detectorId}/${suffix}`
    .replace(/[^a-zA-Z0-9_./-]/g, "-")
    .slice(0, 200);
}

function sanitizeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 100);
}

function sarifLevel(severity: Severity): "error" | "warning" | "note" {
  if (severity === "critical" || severity === "high") return "error";
  if (severity === "medium" || severity === "low") return "warning";
  return "note";
}
