/**
 * Ghost hunt — batch evidence collection for public research.
 *
 * Clones repositories shallowly, runs only the ghost-deps detector, and writes
 * a markdown report plus a JSON dataset. Every published claim about
 * hallucinated packages should be reproducible from these two files.
 *
 *   bun run scripts/ghost-hunt.ts owner/repo owner/other-repo
 *   bun run scripts/ghost-hunt.ts --targets research/targets.txt
 *   bun run scripts/ghost-hunt.ts --targets research/targets.txt --anonymize
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { applyPolicy, loadPolicy } from "../src/config/policy.ts";
import { runScan } from "../src/core/scan.ts";
import { ghostDepsDetector } from "../src/detectors/index.ts";
import type { Finding } from "../src/types/index.ts";
import { VERSION } from "../src/version.ts";

const execFileAsync = promisify(execFile);

const CLONE_TIMEOUT_MS = 120_000;

interface Options {
  targets: string[];
  targetFiles: string[];
  outDir: string;
  anonymize: boolean;
  keepClones: boolean;
  limit?: number;
}

interface GhostRecord {
  package: string;
  ecosystem: string;
  kind: "nonexistent" | "typosquat";
  file?: string;
  line?: number;
  source?: string;
  command?: string;
  typosquatOf?: string;
}

interface RepoResult {
  target: string;
  label: string;
  status: "scanned" | "failed";
  error?: string;
  trustScore?: number;
  findings: number;
  ghosts: GhostRecord[];
  durationMs?: number;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    targets: [],
    targetFiles: [],
    outDir: "research/reports",
    anonymize: false,
    keepClones: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--targets") {
      const value = argv[++i];
      if (!value) throw new Error("--targets requires a file path.");
      options.targetFiles.push(value);
    } else if (arg === "--out") {
      const value = argv[++i];
      if (!value) throw new Error("--out requires a directory path.");
      options.outDir = value;
    } else if (arg === "--limit") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--limit requires a positive integer.");
      }
      options.limit = value;
    } else if (arg === "--anonymize") {
      options.anonymize = true;
    } else if (arg === "--keep-clones") {
      options.keepClones = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: bun run scripts/ghost-hunt.ts [targets…] [options]",
          "",
          "Targets: owner/repo or a full git URL.",
          "",
          "Options:",
          "  --targets <file>   Read targets from a file (one per line, # comments)",
          "  --out <dir>        Output directory (default: research/reports)",
          "  --limit <n>        Scan at most n targets",
          "  --anonymize        Redact repository identities in the markdown report",
          "  --keep-clones      Keep the shallow clones for manual inspection",
        ].join("\n"),
      );
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      options.targets.push(arg);
    }
  }

  return options;
}

async function readTargetFile(path: string): Promise<string[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function cloneUrl(target: string): string {
  if (/^(?:https?:\/\/|git@|ssh:\/\/)/.test(target)) return target;
  if (!/^[\w.-]+\/[\w.-]+$/.test(target)) {
    throw new Error(`Unsupported target "${target}" (use owner/repo or a URL).`);
  }
  return `https://github.com/${target}.git`;
}

function ghostsFrom(findings: Finding[]): GhostRecord[] {
  const ghosts: GhostRecord[] = [];
  for (const finding of findings) {
    if (finding.detectorId !== "ghost-deps") continue;
    const isGhost =
      finding.id.includes("nonexistent") || finding.id.includes("typosquat");
    if (!isGhost) continue;
    const meta = finding.metadata ?? {};
    ghosts.push({
      package:
        typeof meta.package === "string" ? meta.package : (finding.evidence ?? "?"),
      ecosystem: typeof meta.ecosystem === "string" ? meta.ecosystem : "unknown",
      kind: finding.id.includes("nonexistent") ? "nonexistent" : "typosquat",
      file: finding.file,
      line: finding.line,
      source: typeof meta.source === "string" ? meta.source : undefined,
      command: typeof meta.command === "string" ? meta.command : undefined,
      typosquatOf:
        typeof meta.typosquatOf === "string" ? meta.typosquatOf : undefined,
    });
  }
  return ghosts;
}

async function scanTarget(
  target: string,
  index: number,
  options: Options,
): Promise<RepoResult> {
  const label = options.anonymize ? `repo-${index + 1}` : target;
  let dir: string | undefined;

  try {
    dir = await mkdtemp(join(tmpdir(), "ghost-hunt-"));
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--quiet", cloneUrl(target), dir],
      { timeout: CLONE_TIMEOUT_MS },
    );

    const started = Date.now();
    const raw = await runScan({
      rootDir: dir,
      detectors: [ghostDepsDetector],
    });

    // Publishing findings a repository already excludes on purpose (fixtures,
    // vulnerable samples) would be dishonest, so its own policy is applied.
    const { policy } = await loadPolicy(dir);
    const result = applyPolicy(raw, policy);

    return {
      target,
      label,
      status: "scanned",
      trustScore: result.trustScore,
      findings: result.findings.length,
      ghosts: ghostsFrom(result.findings),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      target,
      label,
      status: "failed",
      error: error instanceof Error ? error.message.split("\n")[0] : String(error),
      findings: 0,
      ghosts: [],
    };
  } finally {
    if (dir && !options.keepClones) {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function markdownReport(results: RepoResult[], scannedAt: string): string {
  const scanned = results.filter((r) => r.status === "scanned");
  const affected = scanned.filter((r) => r.ghosts.length > 0);
  const ghostTotal = scanned.reduce((sum, r) => sum + r.ghosts.length, 0);
  const fromDocs = scanned
    .flatMap((r) => r.ghosts)
    .filter((g) => g.source === "docs").length;
  const rate =
    scanned.length > 0
      ? ((affected.length / scanned.length) * 100).toFixed(1)
      : "0.0";

  const lines: string[] = [];
  lines.push(`# Ghost hunt — ${scannedAt.slice(0, 10)}`);
  lines.push("");
  lines.push(
    `Repositories scanned: **${scanned.length}** · with at least one ghost package: ` +
      `**${affected.length}** (${rate}%) · ghost references found: **${ghostTotal}** ` +
      `(of which **${fromDocs}** inside documentation or agent instructions).`,
  );
  lines.push("");
  lines.push("| Repository | Ghost refs | Packages | Trust Score |");
  lines.push("| --- | --- | --- | --- |");
  for (const result of scanned) {
    const packages = [...new Set(result.ghosts.map((g) => g.package))];
    lines.push(
      `| ${result.label} | ${result.ghosts.length} | ` +
        `${packages.length > 0 ? packages.map((p) => `\`${p}\``).join(", ") : "—"} | ` +
        `${result.trustScore ?? "—"} |`,
    );
  }

  if (affected.length > 0) {
    lines.push("");
    lines.push("## Evidence");
    for (const result of affected) {
      lines.push("");
      lines.push(`### ${result.label}`);
      for (const ghost of result.ghosts) {
        const where = ghost.file
          ? `${ghost.file}${ghost.line ? `:${ghost.line}` : ""}`
          : "unknown location";
        const detail = ghost.typosquatOf
          ? `resembles \`${ghost.typosquatOf}\``
          : "does not exist on the registry";
        lines.push(
          `- \`${ghost.package}\` (${ghost.ecosystem}) — ${detail} · ${where}` +
            (ghost.command ? ` · \`${ghost.command}\`` : ""),
        );
      }
    }
  }

  const failed = results.filter((r) => r.status === "failed");
  if (failed.length > 0) {
    lines.push("");
    lines.push("## Not scanned");
    for (const result of failed) {
      lines.push(`- ${result.label}: ${result.error ?? "unknown error"}`);
    }
  }

  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push(`- Tool: novacheck ${VERSION}, ghost-deps detector only.`);
  lines.push(`- Scanned at: ${scannedAt}`);
  lines.push("- Input: shallow clone of the default branch.");
  lines.push(
    "- The repository's own `.novacheck.yml` policy is applied, so paths its maintainers " +
      "exclude (test fixtures, intentionally vulnerable samples) are excluded here too.",
  );
  lines.push(
    "- A finding means a package name is referenced but does not resolve on npm or PyPI, " +
      "or closely resembles a popular package while showing weak trust signals.",
  );
  lines.push(
    "- Reproduce a single result with: `npx novacheck <path-to-clone> --ghosts`",
  );
  lines.push(
    "- Findings describe package references, not the intent or competence of any maintainer. " +
      "See `docs/RESEARCH.md` for the disclosure rules that apply before publication.",
  );
  lines.push("");
  return lines.join("\n");
}

const options = parseOptions(process.argv.slice(2));

const fileTargets: string[] = [];
for (const path of options.targetFiles) {
  fileTargets.push(...(await readTargetFile(path)));
}

let targets = [...new Set([...options.targets, ...fileTargets])];
if (options.limit) targets = targets.slice(0, options.limit);

if (targets.length === 0) {
  console.error(
    "No targets. Pass owner/repo arguments or --targets <file>. Use --help for details.",
  );
  process.exit(2);
}

const scannedAt = new Date().toISOString();
const results: RepoResult[] = [];

for (const [index, target] of targets.entries()) {
  process.stderr.write(`[${index + 1}/${targets.length}] ${target} … `);
  const result = await scanTarget(target, index, options);
  results.push(result);
  process.stderr.write(
    result.status === "failed"
      ? `failed (${result.error ?? "unknown"})\n`
      : `${result.ghosts.length} ghost refs, score ${result.trustScore}\n`,
  );
}

await mkdir(options.outDir, { recursive: true });
const stamp = scannedAt.slice(0, 10);
const markdownPath = join(options.outDir, `ghost-hunt-${stamp}.md`);
const jsonPath = join(options.outDir, `ghost-hunt-${stamp}.json`);

await writeFile(markdownPath, markdownReport(results, scannedAt), "utf8");
await writeFile(
  jsonPath,
  `${JSON.stringify({ tool: `novacheck ${VERSION}`, scannedAt, results }, null, 2)}\n`,
  "utf8",
);

const ghostTotal = results.reduce((sum, r) => sum + r.ghosts.length, 0);
console.log(
  `\n${results.length} targets · ${ghostTotal} ghost references\n` +
    `Report:  ${markdownPath}\nDataset: ${jsonPath}`,
);
