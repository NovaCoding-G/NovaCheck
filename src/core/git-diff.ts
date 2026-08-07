import { execFile } from "node:child_process";
import { relative } from "node:path";
import { promisify } from "node:util";
import { computeTrustScore, sortFindings } from "../scoring/trust-score.ts";
import type { Finding, ScanResult } from "../types/index.ts";

const execFileAsync = promisify(execFile);

export interface ChangedFilesResult {
  base: string;
  files: Set<string>;
}

export async function getChangedFiles(
  rootDir: string,
  base = "HEAD~1",
): Promise<ChangedFilesResult> {
  await assertGitRepository(rootDir);
  const files = new Set<string>();

  const committed = await gitLines(
    rootDir,
    ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`],
    `Unable to compare against "${base}". Verify that the ref exists and use checkout with fetch-depth: 0 in CI.`,
  );
  const unstaged = await gitLines(rootDir, [
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
  ]);
  const staged = await gitLines(rootDir, [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
  ]);
  const untracked = await gitLines(rootDir, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);

  for (const file of [...committed, ...unstaged, ...staged, ...untracked]) {
    files.add(normalizePath(file));
  }
  return { base, files };
}

export function filterResultToChangedFiles(
  result: ScanResult,
  changedFiles: ReadonlySet<string>,
): ScanResult {
  const findings = sortFindings(
    result.findings.filter((finding) =>
      finding.file
        ? changedFiles.has(normalizeFindingPath(result.rootDir, finding))
        : false,
    ),
  );
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(
      finding.detectorId,
      (counts.get(finding.detectorId) ?? 0) + 1,
    );
  }
  const issues = result.diagnostics.issues.filter(
    (issue) =>
      !issue.file ||
      issue.file === "." ||
      pathAffectsChangedFile(issue.file, changedFiles),
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

async function assertGitRepository(rootDir: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", rootDir, "rev-parse", "--is-inside-work-tree"],
      { encoding: "utf8" },
    );
    if (stdout.trim() !== "true") throw new Error("not a work tree");
  } catch {
    throw new Error(
      `--changed requires a Git repository: ${rootDir}. Run "git init" or remove --changed.`,
    );
  }
}

async function gitLines(
  rootDir: string,
  args: string[],
  failureMessage?: string,
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", rootDir, ...args], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    if (failureMessage) throw new Error(failureMessage, { cause: error });
    throw error;
  }
}

function normalizeFindingPath(rootDir: string, finding: Finding): string {
  const file = finding.file ?? "";
  const rel = file.startsWith(rootDir) ? relative(rootDir, file) : file;
  return normalizePath(rel);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function pathAffectsChangedFile(
  issuePath: string,
  changedFiles: ReadonlySet<string>,
): boolean {
  const normalizedIssuePath = normalizePath(issuePath).replace(/\/+$/, "");
  for (const changedFile of changedFiles) {
    const normalizedChangedFile = normalizePath(changedFile);
    if (
      normalizedChangedFile === normalizedIssuePath ||
      normalizedChangedFile.startsWith(`${normalizedIssuePath}/`)
    ) {
      return true;
    }
  }
  return false;
}
