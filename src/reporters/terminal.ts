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
  lines.push(`${ansi.bold}── Diagnostica (--verbose) ──${ansi.reset}`);
  lines.push(
    `${ansi.dim}File totali ricevuti (somma detector): ${d.totalFilesReceived} · unici: ${d.uniqueFilesTouched}${ansi.reset}`,
  );
  lines.push(`${ansi.bold}Pattern di discovery (unione):${ansi.reset}`);
  for (const p of d.discoveryPatterns) {
    lines.push(`  ${ansi.dim}•${ansi.reset} ${p}`);
  }
  lines.push("");
  lines.push(`${ansi.bold}Detector registrati / eseguiti:${ansi.reset}`);
  for (const det of d.detectors) {
    const status =
      det.status === "skipped"
        ? `${ansi.yellow}saltato${ansi.reset}${det.skipReason ? ` — ${det.skipReason}` : ""}`
        : `${ansi.green}eseguito${ansi.reset}`;
    lines.push(
      `  ${ansi.bold}${det.detectorId}${ansi.reset} (${det.name}): ${status}`,
    );
    lines.push(
      `    file ricevuti: ${det.filesReceived} · analizzati: ${det.filesAnalyzed} · finding: ${det.findingsCount}`,
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
    options.minimumScore ?? 70,
    options.failOn ?? [],
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
  lines.push(
    `${actionable.length} ${actionable.length === 1 ? "rischio" : "rischi"} da valutare · ` +
      `${infoCount} ${infoCount === 1 ? "segnale informativo" : "segnali informativi"} · ` +
      `${result.detectorsRun.length} controlli · ${formatDuration(result.durationMs)}`,
  );

  const summary = SEV_SUMMARY(counts);
  if (summary) lines.push(`Severità  ${summary}`);

  lines.push("");
  lines.push(`${ansi.bold}Cosa fare adesso${ansi.reset}`);
  lines.push(`  ${nextAction(counts, actionable.length)}`);

  if (top.length > 0) {
    lines.push("");
    lines.push(
      `${ansi.bold}Rischi prioritari${ansi.reset} ${ansi.dim}(${top.length} di ${actionable.length})${ansi.reset}`,
    );
    lines.push(`${ansi.dim}${"─".repeat(64)}${ansi.reset}`);
    top.forEach((f, i) => {
      const c = sevColor(f.severity);
      lines.push("");
      lines.push(
        `${c}${ansi.bold}[${f.severity.toUpperCase()}]${ansi.reset} ${ansi.bold}${f.title}${ansi.reset}`,
      );
      const where = loc(f);
      if (where) lines.push(`  ${ansi.dim}Dove: ${where}${ansi.reset}`);
      lines.push(`  ${ansi.bold}Rischio${ansi.reset}`);
      lines.push(`  ${wrap(f.explanation, 78, "  ")}`);
      lines.push(`  ${ansi.bold}Correzione consigliata${ansi.reset}`);
      lines.push(`  ${ansi.cyan}${wrap(f.fixPrompt, 78, "  ")}${ansi.reset}`);
      if (i < top.length - 1) {
        lines.push(`  ${ansi.dim}${"·".repeat(32)}${ansi.reset}`);
      }
    });
  } else {
    lines.push("");
    lines.push(
      `${ansi.green}${ansi.bold}Nessun rischio ad alta confidenza rilevato.${ansi.reset}`,
    );
  }

  const rest = actionable.length - top.length;
  if (rest > 0) {
    lines.push("");
    lines.push(
      `${ansi.dim}Altri ${rest} rischi sono disponibili nel report HTML/SARIF.${ansi.reset}`,
    );
  }

  if (result.detectorsSkipped.length > 0) {
    lines.push("");
    lines.push(`${ansi.yellow}${ansi.bold}Copertura parziale${ansi.reset}`);
    for (const skipped of result.detectorsSkipped) {
      lines.push(`  ${ansi.dim}${skipped.id}: ${skipped.reason}${ansi.reset}`);
    }
  }

  if (infoCount > 0) {
    lines.push("");
    lines.push(
      `${ansi.dim}${infoCount} ${infoCount === 1 ? "segnale informativo non incide" : "segnali informativi non incidono"} sul Trust Score.${ansi.reset}`,
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
): { label: string; color: string } {
  const severityGateFailed = failOn.some(
    (severity) => counts[severity] > 0,
  );
  if (counts.critical > 0 || score < minimumScore || severityGateFailed) {
    return { label: "BLOCCATO", color: ansi.red };
  }
  if (counts.high > 0 || counts.medium > 0) {
    return { label: "DA RIVEDERE", color: ansi.yellow };
  }
  return { label: "PRONTO", color: ansi.green };
}

function nextAction(
  counts: Record<Severity, number>,
  actionableCount: number,
): string {
  if (counts.critical > 0) {
    return `Correggi prima i ${counts.critical} finding critical: non pubblicare ancora.`;
  }
  if (counts.high > 0) {
    return `Rivedi i ${counts.high} finding high prima del merge o della pubblicazione.`;
  }
  if (actionableCount > 0) {
    return "Valuta i finding medium/low e documenta gli eventuali rischi accettati.";
  }
  return "Nessuna correzione obbligatoria. Mantieni il controllo nella CI.";
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
