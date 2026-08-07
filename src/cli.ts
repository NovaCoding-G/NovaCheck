#!/usr/bin/env node
/**
 * NovaCheck CLI — local-first trust scan for AI-generated projects.
 *
 * Usage:
 *   novacheck [dir] [--offline] [--changed [base]] [--sarif [path]]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  applyPolicy,
  loadPolicy,
  policyFailureReasons,
} from "./config/policy.ts";
import {
  filterResultToChangedFiles,
  getChangedFiles,
} from "./core/git-diff.ts";
import { runScan } from "./core/scan.ts";
import { formatBadgeMarkdown, formatBadgeSvg } from "./reporters/badge.ts";
import { formatHtmlReport } from "./reporters/html.ts";
import { formatSarifReport } from "./reporters/sarif.ts";
import { formatTerminalReport } from "./reporters/terminal.ts";
import { VERSION } from "./version.ts";

interface CliArgs {
  rootDir: string;
  offline: boolean;
  verbose: boolean;
  html: boolean;
  htmlPath?: string;
  writeBadge: boolean;
  failBelow?: number;
  failOnIncomplete?: boolean;
  sarif: boolean;
  sarifPath?: string;
  changed: boolean;
  changedBase?: string;
  policyPath?: string;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    rootDir: process.cwd(),
    offline: false,
    verbose: false,
    html: true,
    writeBadge: false,
    sarif: false,
    changed: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (a === "--version" || a === "-V") {
      args.version = true;
    } else if (a === "--offline") {
      args.offline = true;
    } else if (a === "--verbose" || a === "--debug" || a === "-v") {
      args.verbose = true;
    } else if (a === "--badge") {
      args.writeBadge = true;
    } else if (a === "--no-badge") {
      args.writeBadge = false;
    } else if (a === "--no-html") {
      args.html = false;
    } else if (a === "--html") {
      args.html = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        args.htmlPath = resolve(next);
        i++;
      }
    } else if (a === "--sarif") {
      args.sarif = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("-") && /\.sarif(?:\.json)?$/i.test(next)) {
        args.sarifPath = resolve(next);
        i++;
      }
    } else if (a === "--changed") {
      args.changed = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        args.changedBase = next;
        i++;
      }
    } else if (a === "--policy") {
      const next = argv[++i];
      if (!next || next.startsWith("-")) {
        throw new Error("--policy requires a file path.");
      }
      args.policyPath = resolve(next);
    } else if (a === "--fail-below") {
      const next = argv[++i];
      const value = Number(next);
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        throw new Error("--fail-below must be an integer between 0 and 100.");
      }
      args.failBelow = value;
    } else if (a === "--fail-on-incomplete") {
      args.failOnIncomplete = true;
    } else if (a === "--allow-incomplete") {
      args.failOnIncomplete = false;
    } else if (a.startsWith("-")) {
      throw new Error(`Unknown option: ${a}`);
    } else if (!a.startsWith("-")) {
      args.rootDir = resolve(a);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`NovaCheck — security and AI provenance for AI-generated projects

Usage:
  novacheck [directory] [options]

Detectors:
  ghost-deps, secrets, env-leak, supply-chain,
  dangerous-sinks (shell/SQL/CORS/TLS/eval/XSS/deser), insecure-crypto,
  ai-unreviewed, ai-presence (explicit markers only)

Options:
  --offline         Disable network access (registry cache only)
  --changed [base]  Show and score findings only in files changed from base
                    (default: HEAD~1; includes staged, unstaged, and untracked)
  --policy <path>   YAML/JSON policy (default: .novacheck.yml when present)
  --sarif [path]    Write SARIF for GitHub Code Scanning
  --verbose, -v     Diagnostics: detectors, files received/analyzed, patterns
  --debug           Alias for --verbose
  --html [path]     Write HTML report (default: <dir>/.novacheck/report.html)
  --no-html         Do not write the HTML report
  --badge           Write an SVG badge and README snippet
  --fail-below N    Override the policy threshold (default: 85)
  --fail-on-incomplete
                    Fail when any input could not be analyzed
  --allow-incomplete
                    Warn but do not fail on incomplete analysis (local default)
  -V, --version     Show the version
  -h, --help        Show this help
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    console.log(`novacheck ${VERSION}`);
    return;
  }

  const outDir = join(args.rootDir, ".novacheck");
  const htmlPath = args.htmlPath ?? join(outDir, "report.html");
  const sarifPath =
    args.sarifPath ?? join(outDir, "novacheck-results.sarif");
  const loadedPolicy = await loadPolicy(args.rootDir, args.policyPath);
  const policy = {
    ...loadedPolicy.policy,
    minimumScore: args.failBelow ?? loadedPolicy.policy.minimumScore,
    failOnIncomplete:
      args.failOnIncomplete ?? loadedPolicy.policy.failOnIncomplete,
  };

  let result = await runScan({
    rootDir: args.rootDir,
    offline: args.offline,
  });
  let reportScope: {
    mode: "full" | "changed";
    base?: string;
    filesCount?: number;
  } = { mode: "full" };

  if (args.changed) {
    const changed = await getChangedFiles(args.rootDir, args.changedBase);
    result = filterResultToChangedFiles(result, changed.files);
    reportScope = {
      mode: "changed",
      base: changed.base,
      filesCount: changed.files.size,
    };
    console.log(
      `Diff scope: ${changed.files.size} changed ${changed.files.size === 1 ? "file" : "files"} compared with ${changed.base}`,
    );
  }
  result = applyPolicy(result, policy);
  const minimumScore = policy.minimumScore ?? 85;
  const failures = policyFailureReasons(result, policy, 85);

  process.stdout.write(
    formatTerminalReport(result, {
      verbose: args.verbose,
      minimumScore,
      failOn: policy.failOn,
      failOnIncomplete: policy.failOnIncomplete,
    }),
  );

  if (args.html) {
    await mkdir(dirname(htmlPath), { recursive: true });
    await writeFile(
      htmlPath,
      formatHtmlReport(result, {
        minimumScore,
        failOn: policy.failOn,
        failOnIncomplete: policy.failOnIncomplete,
      }),
      "utf8",
    );
    console.log(`Report HTML: ${htmlPath}`);
  }

  if (args.sarif) {
    await mkdir(dirname(sarifPath), { recursive: true });
    await writeFile(
      sarifPath,
      formatSarifReport(result, {
        policyFailures: failures,
        minimumScore,
        failOn: policy.failOn,
        scope: reportScope,
      }),
      "utf8",
    );
    console.log(`Report SARIF: ${sarifPath}`);
  }

  if (args.writeBadge) {
    await mkdir(outDir, { recursive: true });
    const svgPath = join(outDir, "badge.svg");
    await writeFile(svgPath, formatBadgeSvg(result), "utf8");
    const md = formatBadgeMarkdown(result);
    console.log(`Badge SVG:   ${svgPath}`);
    console.log(`Badge README:\n${md}\n`);
  }

  if (loadedPolicy.path) {
    console.log(`Policy: ${loadedPolicy.path}`);
  }
  if (failures.length > 0) {
    console.error(`NovaCheck policy failed:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(
    `NovaCheck error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
}
