import type { Finding, ScanResult, Severity } from "../types/index.ts";
import {
  countBySeverity,
  scoreBand,
  topPriorityFindings,
} from "../scoring/trust-score.ts";

const isTty = typeof process.stdout?.isTTY === "boolean" && process.stdout.isTTY;

const ansi = {
  reset: isTty ? "\x1b[0m" : "",
  bold: isTty ? "\x1b[1m" : "",
  dim: isTty ? "\x1b[2m" : "",
  red: isTty ? "\x1b[31m" : "",
  yellow: isTty ? "\x1b[33m" : "",
  green: isTty ? "\x1b[32m" : "",
  cyan: isTty ? "\x1b[36m" : "",
  magenta: isTty ? "\x1b[35m" : "",
};

function sevColor(s: Severity): string {
  switch (s) {
    case "critical":
      return ansi.red;
    case "high":
      return ansi.magenta;
    case "medium":
      return ansi.yellow;
    case "low":
      return ansi.cyan;
    default:
      return ansi.dim;
  }
}

function scoreColor(score: number): string {
  if (score >= 70) return ansi.green;
  if (score >= 50) return ansi.yellow;
  return ansi.red;
}

function loc(f: Finding): string {
  if (!f.file) return "";
  return f.line ? `${f.file}:${f.line}` : f.file;
}

/** Diagnostic block printed before findings when --verbose / --debug is on. */
export function formatVerboseDiagnostics(result: ScanResult): string {
  const d = result.diagnostics;
  const lines: string[] = [];
  lines.push("");
  lines.push(`${ansi.bold}── Diagnostics (--verbose) ──${ansi.reset}`);
  lines.push(
    `${ansi.dim}Files received (detector total): ${d.totalFilesReceived} · unique: ${d.uniqueFilesTouched}${ansi.reset}`,
  );
  lines.push(`${ansi.bold}Discovery patterns (combined):${ansi.reset}`);
  for (const p of d.discoveryPatterns) {
    lines.push(`  ${ansi.dim}•${ansi.reset} ${p}`);
  }
  lines.push("");
  lines.push(`${ansi.bold}Registered / executed detectors:${ansi.reset}`);
  for (const det of d.detectors) {
    const status =
      det.status === "skipped"
        ? `${ansi.yellow}skipped${ansi.reset}${det.skipReason ? ` — ${det.skipReason}` : ""}`
        : det.status === "degraded"
          ? `${ansi.yellow}degraded${ansi.reset}`
          : `${ansi.green}completed${ansi.reset}`;
    lines.push(
      `  ${ansi.bold}${det.detectorId}${ansi.reset} (${det.name}): ${status}`,
    );
    lines.push(
      `    files received: ${det.filesReceived} · analyzed: ${det.filesAnalyzed} · findings: ${det.findingsCount}`,
    );
    if (det.discoveryPatterns.length > 0) {
      lines.push(`    pattern:`);
      for (const p of det.discoveryPatterns) {
        lines.push(`      ${ansi.dim}- ${p}${ansi.reset}`);
      }
    }
  }
  lines.push(`${ansi.dim}${"─".repeat(40)}${ansi.reset}`);
  lines.push("");
  return lines.join("\n");
}

export function formatTerminalReport(
  result: ScanResult,
  options: {
    verbose?: boolean;
    minimumScore?: number;
    failOn?: Severity[];
    failOnIncomplete?: boolean;
  } = {},
): string {
  const band = scoreBand(result.trustScore);
  const counts = countBySeverity(result.findings);
  const actionable = result.findings.filter((f) => f.severity !== "info");
  const infoCount = counts.info;
  const top = topPriorityFindings(actionable, 5);
  const status = scanStatus(
    result.trustScore,
    counts,
    options.minimumScore ?? 85,
    options.failOn ?? [],
    Boolean(options.failOnIncomplete && result.diagnostics.incomplete),
  );
  const lines: string[] = [];

  if (options.verbose) {
    lines.push(formatVerboseDiagnostics(result).trimEnd());
  }

  lines.push("");
  lines.push(`${ansi.bold}NOVACHECK${ansi.reset}  Security & AI Trust`);
  lines.push(`${ansi.dim}${result.rootDir}${ansi.reset}`);
  lines.push(`${ansi.dim}${"─".repeat(64)}${ansi.reset}`);
  lines.push("");
  lines.push(
    `${status.color}${ansi.bold}${status.label}${ansi.reset}  ` +
      `${ansi.bold}Trust Score${ansi.reset} ` +
      `${scoreColor(result.trustScore)}${ansi.bold}${result.trustScore}/100${ansi.reset}  ` +
      `${scoreBar(result.trustScore)}  ${ansi.dim}${band.label}${ansi.reset}`,
  );
  if (result.diagnostics.incomplete) {
    lines.push(
      `${ansi.yellow}${ansi.bold}INCOMPLETE${ansi.reset}  ` +
        `${result.diagnostics.issues.length} ${result.diagnostics.issues.length === 1 ? "input was" : "inputs were"} not fully analyzed`,
    );
  }
  lines.push(
    `${actionable.length} ${actionable.length === 1 ? "risk" : "risks"} to review · ` +
      `${infoCount} informational ${infoCount === 1 ? "signal" : "signals"} · ` +
      `${result.detectorsRun.length} checks · ${formatDuration(result.durationMs)}`,
  );

  const summary = SEV_SUMMARY(counts);
  if (summary) lines.push(`Severity  ${summary}`);

  lines.push("");
  lines.push(`${ansi.bold}What to do next${ansi.reset}`);
  lines.push(
    `  ${nextAction(counts, actionable.length, result.diagnostics.incomplete)}`,
  );

  if (top.length > 0) {
    lines.push("");
    lines.push(
      `${ansi.bold}Priority risks${ansi.reset} ${ansi.dim}(${top.length} of ${actionable.length})${ansi.reset}`,
    );
    lines.push(`${ansi.dim}${"─".repeat(64)}${ansi.reset}`);
    top.forEach((f, i) => {
      const c = sevColor(f.severity);
      lines.push("");
      lines.push(
        `${c}${ansi.bold}[${f.severity.toUpperCase()}]${ansi.reset} ${ansi.bold}${f.title}${ansi.reset}`,
      );
      const where = loc(f);
      if (where) lines.push(`  ${ansi.dim}Location: ${where}${ansi.reset}`);
      lines.push(`  ${ansi.bold}Risk${ansi.reset}`);
      lines.push(`  ${wrap(f.explanation, 78, "  ")}`);
      lines.push(`  ${ansi.bold}Recommended fix${ansi.reset}`);
      lines.push(`  ${ansi.cyan}${wrap(f.fixPrompt, 78, "  ")}${ansi.reset}`);
      if (i < top.length - 1) {
        lines.push(`  ${ansi.dim}${"·".repeat(32)}${ansi.reset}`);
      }
    });
  } else {
    lines.push("");
    if (result.diagnostics.incomplete) {
      lines.push(
        `${ansi.yellow}${ansi.bold}No risks detected in the analyzed inputs, but analysis is incomplete.${ansi.reset}`,
      );
    } else {
      lines.push(
        `${ansi.green}${ansi.bold}No high-confidence risks detected.${ansi.reset}`,
      );
    }
  }

  const rest = actionable.length - top.length;
  if (rest > 0) {
    lines.push("");
    lines.push(
      `${ansi.dim}${rest} more ${rest === 1 ? "risk is" : "risks are"} available in the HTML/SARIF report.${ansi.reset}`,
    );
  }

  if (result.detectorsSkipped.length > 0) {
    lines.push("");
    lines.push(`${ansi.yellow}${ansi.bold}Partial coverage${ansi.reset}`);
    for (const skipped of result.detectorsSkipped) {
      lines.push(`  ${ansi.dim}${skipped.id}: ${skipped.reason}${ansi.reset}`);
    }
  }

  if (result.diagnostics.issues.length > 0) {
    lines.push("");
    lines.push(`${ansi.yellow}${ansi.bold}Incomplete analysis${ansi.reset}`);
    for (const issue of result.diagnostics.issues.slice(0, 20)) {
      const where = issue.file ? ` (${issue.file})` : "";
      lines.push(
        `  ${ansi.dim}${issue.detectorId}/${issue.code}${where}: ${issue.message}${ansi.reset}`,
      );
    }
    const hidden = result.diagnostics.issues.length - 20;
    if (hidden > 0) {
      lines.push(
        `  ${ansi.dim}… ${hidden} more incomplete ${hidden === 1 ? "input" : "inputs"} in HTML/SARIF diagnostics${ansi.reset}`,
      );
    }
  }

  if (infoCount > 0) {
    lines.push("");
    lines.push(
      `${ansi.dim}${infoCount} informational ${infoCount === 1 ? "signal does" : "signals do"} not affect the Trust Score.${ansi.reset}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

function SEV_SUMMARY(counts: Record<Severity, number>): string {
  const parts: string[] = [];
  for (const s of ["critical", "high", "medium", "low"] as Severity[]) {
    if (counts[s] > 0) {
      parts.push(`${sevColor(s)}${counts[s]} ${s}${ansi.reset}`);
    }
  }
  return parts.length ? parts.join(" · ") : "";
}

function scanStatus(
  score: number,
  counts: Record<Severity, number>,
  minimumScore: number,
  failOn: readonly Severity[],
  incompleteGateFailed: boolean,
): { label: string; color: string } {
  const severityGateFailed = failOn.some(
    (severity) => counts[severity] > 0,
  );
  if (
    counts.critical > 0 ||
    score < minimumScore ||
    severityGateFailed ||
    incompleteGateFailed
  ) {
    return { label: "BLOCKED", color: ansi.red };
  }
  if (counts.high > 0 || counts.medium > 0) {
    return { label: "REVIEW", color: ansi.yellow };
  }
  return { label: "READY", color: ansi.green };
}

function nextAction(
  counts: Record<Severity, number>,
  actionableCount: number,
  incomplete: boolean,
): string {
  if (incomplete) {
    return "Resolve incomplete checks or rerun the scan before treating this result as verified.";
  }
  if (counts.critical > 0) {
    return `Fix the ${counts.critical} critical ${counts.critical === 1 ? "finding" : "findings"} first. Do not ship yet.`;
  }
  if (counts.high > 0) {
    return `Review the ${counts.high} high-severity ${counts.high === 1 ? "finding" : "findings"} before merging or shipping.`;
  }
  if (actionableCount > 0) {
    return "Review medium/low findings and document any accepted risks.";
  }
  return "No mandatory fixes. Keep NovaCheck enabled in CI.";
}

function scoreBar(score: number): string {
  const width = 16;
  const filled = Math.round((score / 100) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000
    ? `${durationMs}ms`
    : `${(durationMs / 1000).toFixed(1)}s`;
}

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const rows: string[] = [];
  let row = "";
  for (const w of words) {
    if (!row) {
      row = w;
      continue;
    }
    if ((row + " " + w).length > width) {
      rows.push(row);
      row = w;
    } else {
      row += " " + w;
    }
  }
  if (row) rows.push(row);
  return rows.join(`\n${indent}`);
}
