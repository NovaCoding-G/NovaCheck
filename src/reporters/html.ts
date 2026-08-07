import type { Finding, ScanResult, Severity } from "../types/index.ts";
import {
  countBySeverity,
  scoreBand,
} from "../scoring/trust-score.ts";
import { formatBadgeMarkdown } from "./badge.ts";

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function loc(f: Finding): string {
  if (!f.file) return "—";
  return f.line ? `${f.file}:${f.line}` : f.file;
}

export function formatHtmlReport(
  result: ScanResult,
  options: {
    minimumScore?: number;
    failOn?: Severity[];
    failOnIncomplete?: boolean;
  } = {},
): string {
  const band = scoreBand(result.trustScore);
  const counts = countBySeverity(result.findings);
  const actionable = result.findings.filter((f) => f.severity !== "info");
  const minimumScore = options.minimumScore ?? 85;
  const severityGateFailed = (options.failOn ?? []).some(
    (severity) => counts[severity] > 0,
  );
  const status =
    counts.critical > 0 ||
    result.trustScore < minimumScore ||
    severityGateFailed ||
    (options.failOnIncomplete && result.diagnostics.incomplete)
      ? { label: "Blocked", className: "blocked" }
      : counts.high > 0 || counts.medium > 0
        ? { label: "Review required", className: "review" }
        : { label: "Ready", className: "ready" };
  const badgeMd = formatBadgeMarkdown(result);
  const scanned = new Date(result.scannedAt).toLocaleString("en-US");

  const allHtml = result.findings
    .map(
      (f, index) => `
      <article class="finding sev-${f.severity}" data-severity="${f.severity}">
        <div class="finding-head">
          <span class="pill sev-${f.severity}">${esc(f.severity)}</span>
          <div class="finding-title">
            <h3>${esc(f.title)}</h3>
            <p class="loc">${esc(loc(f))} · ${esc(f.detectorId)}</p>
          </div>
        </div>
        <details ${index < 5 && f.severity !== "info" ? "open" : ""}>
          <summary>Details and remediation</summary>
          <div class="finding-body">
            <h4>Why this is a risk</h4>
            <p>${esc(f.explanation)}</p>
            ${
              f.evidence
                ? `<h4>Evidence</h4><code class="evidence">${esc(f.evidence)}</code>`
                : ""
            }
            <div class="fix">
              <div class="fix-head">
                <h4>Recommended fix</h4>
                <button type="button" class="copy" data-copy="fix-${index}">Copy prompt</button>
              </div>
              <pre id="fix-${index}">${esc(f.fixPrompt)}</pre>
            </div>
          </div>
        </details>
      </article>`,
    )
    .join("\n");

  const skips =
    result.detectorsSkipped.length > 0
      ? `<ul class="skips">${result.detectorsSkipped
          .map((s) => `<li><code>${esc(s.id)}</code> — ${esc(s.reason)}</li>`)
          .join("")}</ul>`
      : "";
  const incompleteIssues =
    result.diagnostics.issues.length > 0
      ? `<ul class="skips">${result.diagnostics.issues
          .map(
            (issue) =>
              `<li><code>${esc(issue.detectorId)}/${esc(issue.code)}</code>${issue.file ? ` — ${esc(issue.file)}` : ""}: ${esc(issue.message)}</li>`,
          )
          .join("")}</ul>`
      : "";

  const filters = (["critical", "high", "medium", "low", "info"] as Severity[])
    .filter((severity) => counts[severity] > 0)
    .map(
      (severity) =>
        `<button type="button" class="filter" data-filter="${severity}">${severity} <span>${counts[severity]}</span></button>`,
    )
    .join("");

  const nextAction =
    result.diagnostics.incomplete
      ? "Resolve incomplete checks or rerun the scan before treating this result as verified."
      : counts.critical > 0
      ? `Fix the ${counts.critical} critical ${counts.critical === 1 ? "finding" : "findings"} before shipping.`
      : counts.high > 0
        ? `Review the ${counts.high} high-severity ${counts.high === 1 ? "finding" : "findings"} before merging.`
        : actionable.length > 0
          ? "Review medium and low findings, then document any accepted risks."
          : "No mandatory fixes. Keep NovaCheck enabled in CI.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>NovaCheck — Trust Score ${result.trustScore}/100</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f8fa;
      --surface: #ffffff;
      --surface-2: #f1f3f5;
      --text: #17191c;
      --muted: #5e6670;
      --line: #dfe3e8;
      --accent: #0969da;
      --ready: #16794b;
      --review: #9a6700;
      --blocked: #cf222e;
      --critical: #cf222e;
      --high: #bc4c00;
      --medium: #9a6700;
      --low: #0969da;
      --info: #57606a;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background: var(--bg);
    }
    a { color: var(--accent); }
    button { font: inherit; }
    button:focus-visible, summary:focus-visible, a:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--accent) 35%, transparent);
      outline-offset: 2px;
    }
    .skip-link { position: absolute; left: -9999px; }
    .skip-link:focus { left: 1rem; top: 1rem; z-index: 10; background: var(--surface); padding: .6rem; }
    .topbar { border-bottom: 1px solid var(--line); background: var(--surface); }
    .topbar-inner, main { max-width: 1040px; margin: 0 auto; }
    .topbar-inner { padding: 1rem 1.25rem; display: flex; justify-content: space-between; gap: 1rem; align-items: center; }
    .brand { font-size: 1.05rem; font-weight: 750; letter-spacing: .02em; }
    .privacy { color: var(--muted); font-size: .82rem; }
    main { padding: 2rem 1.25rem 4rem; }
    h1 { font-size: 1.55rem; margin: 0; }
    h2 { font-size: 1.12rem; margin: 2rem 0 .8rem; }
    h3 { font-size: .98rem; margin: 0; }
    h4 { font-size: .82rem; margin: 1rem 0 .3rem; text-transform: uppercase; letter-spacing: .035em; color: var(--muted); }
    .sub { color: var(--muted); margin: .25rem 0 0; font-size: .88rem; overflow-wrap: anywhere; }
    .summary {
      display: grid;
      grid-template-columns: 180px 1fr;
      margin-top: 1.25rem;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    .score {
      display: grid;
      place-content: center;
      text-align: center;
      padding: 1.5rem;
      border-right: 1px solid var(--line);
    }
    .score strong { display: block; font-size: 2.2rem; line-height: 1; }
    .score span { color: var(--muted); font-size: .78rem; }
    .summary-main { padding: 1.35rem 1.5rem; }
    .status { display: inline-flex; align-items: center; gap: .4rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; font-size: .76rem; }
    .status::before { content: ""; width: .55rem; height: .55rem; border-radius: 50%; background: currentColor; }
    .status.ready { color: var(--ready); }
    .status.review { color: var(--review); }
    .status.blocked { color: var(--blocked); }
    progress { display: block; width: 100%; height: .55rem; margin: .8rem 0; accent-color: var(--accent); }
    .summary-meta { color: var(--muted); font-size: .85rem; }
    .next {
      margin-top: 1rem;
      padding: .8rem 1rem;
      border-left: 4px solid var(--accent);
      background: var(--surface-2);
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: .65rem;
      margin-top: 1rem;
    }
    .metric { padding: .75rem; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
    .metric strong { display: block; font-size: 1.25rem; }
    .metric span { color: var(--muted); font-size: .75rem; text-transform: uppercase; }
    .controls { display: flex; flex-wrap: wrap; gap: .45rem; margin-bottom: .85rem; }
    .filter, .copy {
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--text);
      border-radius: 6px;
      padding: .38rem .65rem;
      cursor: pointer;
    }
    .filter[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); background: var(--surface-2); }
    .filter span { color: var(--muted); margin-left: .25rem; }
    .pill {
      display: inline-block;
      font-size: .72rem;
      text-transform: uppercase;
      letter-spacing: .04em;
      padding: .16rem .48rem;
      border: 1px solid currentColor;
      border-radius: 999px;
      font-weight: 650;
    }
    .sev-critical { color: var(--critical); }
    .sev-high { color: var(--high); }
    .sev-medium { color: var(--medium); }
    .sev-low { color: var(--low); }
    .sev-info { color: var(--info); }
    .finding {
      color: var(--text);
      background: var(--surface);
      border: 1px solid var(--line);
      border-left: 4px solid var(--info);
      border-radius: 6px;
      margin-bottom: .85rem;
    }
    .finding.sev-critical { border-left-color: var(--critical); }
    .finding.sev-high { border-left-color: var(--high); }
    .finding.sev-medium { border-left-color: var(--medium); }
    .finding.sev-low { border-left-color: var(--low); }
    .finding-head { display: flex; align-items: flex-start; gap: .75rem; padding: .9rem 1rem; }
    .finding-title { min-width: 0; flex: 1; }
    .loc { color: var(--muted); font: .78rem ui-monospace, "Cascadia Code", monospace; margin: .2rem 0 0; overflow-wrap: anywhere; }
    details { border-top: 1px solid var(--line); }
    summary { cursor: pointer; padding: .55rem 1rem; color: var(--muted); font-size: .82rem; }
    .finding-body { padding: 0 1rem 1rem; }
    .finding-body p { margin: .3rem 0; }
    .fix {
      margin-top: 1rem;
      background: var(--surface-2);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: .75rem;
    }
    .fix-head { display: flex; justify-content: space-between; gap: 1rem; align-items: center; }
    .fix-head h4 { margin: 0; }
    .copy { font-size: .78rem; white-space: nowrap; }
    pre {
      margin: .65rem 0 0; white-space: pre-wrap; word-break: break-word;
      font-family: ui-monospace, "Cascadia Code", monospace;
      font-size: .82rem;
    }
    .evidence { display: block; padding: .55rem .65rem; background: var(--surface-2); border-radius: 4px; overflow-wrap: anywhere; }
    .empty { padding: 1.2rem; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; color: var(--ready); }
    .badge-box {
      margin-top: 2rem;
      padding: 1rem 1.1rem;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 6px;
    }
    .badge-box code {
      display: block;
      margin-top: .5rem;
      padding: .65rem;
      background: var(--surface-2);
      font-size: .8rem;
      overflow-x: auto;
    }
    .skips { color: var(--muted); font-size: .9rem; }
    .coverage { margin-top: 1rem; }
    .coverage summary { padding-left: 0; }
    footer { margin-top: 2.5rem; color: var(--muted); font-size: .8rem; }
    [hidden] { display: none !important; }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f1115; --surface: #171a20; --surface-2: #20242c;
        --text: #edf0f3; --muted: #a5adb8; --line: #343a44; --accent: #58a6ff;
        --ready: #3fb950; --review: #d29922; --blocked: #f85149;
        --critical: #f85149; --high: #f0883e; --medium: #d29922; --low: #58a6ff; --info: #a5adb8;
      }
    }
    @media (max-width: 680px) {
      .privacy { display: none; }
      .summary { grid-template-columns: 1fr; }
      .score { border-right: 0; border-bottom: 1px solid var(--line); }
      .metrics { grid-template-columns: repeat(2, 1fr); }
      .finding-head { align-items: flex-start; }
      .fix-head { align-items: flex-start; }
    }
    @media print {
      body { background: white; color: black; }
      .topbar, .controls, .copy, .badge-box { display: none; }
      main { max-width: none; padding: 0; }
      .finding { break-inside: avoid; }
      details > * { display: block; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#findings">Skip to findings</a>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">NovaCheck</div>
      <div class="privacy">Local report · no source code sent to the cloud</div>
    </div>
  </header>
  <main>
    <h1>Security &amp; AI Trust Report</h1>
    <p class="sub">${esc(result.rootDir)} · ${esc(scanned)}</p>

    <section class="summary" aria-labelledby="summary-title">
      <div class="score" aria-label="Trust Score ${result.trustScore} out of 100">
        <strong>${result.trustScore}</strong>
        <span>Trust Score / 100</span>
      </div>
      <div class="summary-main">
        <div class="status ${status.className}">${status.label}</div>
        <h2 id="summary-title" style="margin:.35rem 0 0">${actionable.length} ${actionable.length === 1 ? "risk" : "risks"} to review</h2>
        <progress max="100" value="${result.trustScore}">${result.trustScore}%</progress>
        <div class="summary-meta">${esc(band.label)} · ${result.detectorsRun.length} checks · ${result.durationMs}ms · ${counts.info} informational ${counts.info === 1 ? "signal" : "signals"}${result.diagnostics.incomplete ? " · INCOMPLETE" : ""}</div>
        <div class="next"><strong>Next step:</strong> ${esc(nextAction)}</div>
      </div>
    </section>

    <section class="metrics" aria-label="Severity summary">
      ${(["critical", "high", "medium", "low", "info"] as Severity[])
        .map(
          (severity) =>
            `<div class="metric sev-${severity}"><strong>${counts[severity]}</strong><span>${severity}</span></div>`,
        )
        .join("")}
    </section>

    <section id="findings" aria-labelledby="findings-title">
      <h2 id="findings-title">Finding</h2>
      ${
        result.findings.length > 0
          ? `<div class="controls" aria-label="Filter findings">
              <button type="button" class="filter" data-filter="all" aria-pressed="true">All <span>${result.findings.length}</span></button>
              ${filters}
            </div>
            <div id="finding-list">${allHtml}</div>`
          : result.diagnostics.incomplete
            ? `<div class="empty"><strong>No risks detected in the analyzed inputs, but analysis is incomplete.</strong><br/>Resolve the incomplete checks before treating this result as verified.</div>`
            : `<div class="empty"><strong>No high-confidence risks detected.</strong><br/>The score does not replace tests, code review, or threat modeling.</div>`
      }
    </section>

    ${
      skips
        ? `<details class="coverage">
             <summary>Partial coverage: ${result.detectorsSkipped.length} ${result.detectorsSkipped.length === 1 ? "check was" : "checks were"} skipped</summary>
             ${skips}
           </details>`
        : ""
    }

    ${
      incompleteIssues
        ? `<details class="coverage" open>
             <summary>Incomplete analysis: ${result.diagnostics.issues.length} ${result.diagnostics.issues.length === 1 ? "input was" : "inputs were"} not fully analyzed</summary>
             ${incompleteIssues}
           </details>`
        : ""
    }

    <details class="badge-box">
      <summary><strong>README badge</strong></summary>
      <p class="sub">Paste this snippet into your README:</p>
      <code>${esc(badgeMd)}</code>
    </details>

    <footer>Generated by NovaCheck · The Trust Score reflects detected signals and does not guarantee the absence of vulnerabilities.</footer>
  </main>
  <script>
    document.querySelectorAll(".filter").forEach((button) => {
      button.addEventListener("click", () => {
        const filter = button.dataset.filter;
        document.querySelectorAll(".filter").forEach((item) =>
          item.setAttribute("aria-pressed", String(item === button))
        );
        document.querySelectorAll(".finding").forEach((finding) => {
          finding.hidden = filter !== "all" && finding.dataset.severity !== filter;
        });
      });
    });
    document.querySelectorAll(".copy").forEach((button) => {
      button.addEventListener("click", async () => {
        const target = document.getElementById(button.dataset.copy);
        if (!target) return;
        const text = target.textContent || "";
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
          } else {
            const area = document.createElement("textarea");
            area.value = text;
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();
            document.execCommand("copy");
            area.remove();
          }
        } catch {
          return;
        }
        const previous = button.textContent;
        button.textContent = "Copied";
        setTimeout(() => { button.textContent = previous; }, 1400);
      });
    });
  </script>
</body>
</html>
`;
}
