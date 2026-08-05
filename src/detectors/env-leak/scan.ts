import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { Finding } from "../../types/index.ts";
import { listTextFiles, toRel } from "../secrets/walk.ts";

const execFileAsync = promisify(execFile);

export const ENV_LEAK_PATTERNS = [
  "recursive .env / .env.* discovery",
  "git check-ignore + git ls-files for each file",
] as const;

export interface EnvLeakScanResult {
  findings: Finding[];
  filesReceived: number;
  filesAnalyzed: number;
  files: string[];
  discoveryPatterns: string[];
}

export async function runEnvLeakScan(
  rootDir: string,
): Promise<EnvLeakScanResult> {
  const findings: Finding[] = [];
  const allFiles = await listTextFiles(rootDir);
  const files = allFiles.filter((file) => {
    const name = basename(file);
    return isEnvFamily(name) && !isTemplate(name);
  });
  // Use full Git ignore/tracking only when scanning the repository root.
  // Nested scan roots (fixtures, package folders) fall back to local
  // `.gitignore` for ignore rules, but still detect files already tracked.
  const gitToplevel = await gitToplevelOf(rootDir);
  const scanIsGitRoot =
    gitToplevel !== undefined && pathsEqual(gitToplevel, rootDir);

  for (const abs of files) {
    const rel = toRel(rootDir, abs);
    const status = scanIsGitRoot
      ? await gitStatus(rootDir, rel)
      : {
          ignored: await fallbackIgnored(rootDir, rel),
          tracked:
            gitToplevel !== undefined
              ? await isTrackedUnder(gitToplevel, abs)
              : false,
        };
    if (status.ignored && !status.tracked) continue;

    findings.push({
      id: `env-leak:present:${rel}`,
      detectorId: "env-leak",
      severity: "critical",
      title: status.tracked
        ? `${rel} contains sensitive configuration and is tracked by Git`
        : `${rel} is not protected by .gitignore`,
      explanation: status.tracked
        ? `The file \`${rel}\` is already tracked by Git. Adding it to .gitignore will not remove it from history, and its credentials must be considered compromised.`
        : `The file \`${rel}\` exists but is not ignored by Git. It could be committed and expose real credentials.`,
      fixPrompt: status.tracked
        ? `Remove ${rel} from the Git index and history, add it to .gitignore, and rotate every credential it contains. Keep only placeholder-based templates.`
        : `Add a rule for ${rel} (or all .env* files) to .gitignore and keep only templates. Do not commit this file.`,
      file: rel,
      evidence: status.tracked ? "tracked by Git" : "not ignored by Git",
      metadata: { tracked: status.tracked, ignored: status.ignored },
    });
  }

  return {
    findings,
    filesReceived: files.length,
    filesAnalyzed: files.length,
    files,
    discoveryPatterns: [...ENV_LEAK_PATTERNS],
  };
}

async function gitToplevelOf(rootDir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", rootDir, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" },
    );
    const top = stdout.trim();
    return top.length > 0 ? top : undefined;
  } catch {
    return undefined;
  }
}

function pathsEqual(a: string, b: string): boolean {
  const norm = (p: string) => p.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

async function isTrackedUnder(
  gitToplevel: string,
  absFile: string,
): Promise<boolean> {
  const relFromTop = toRel(gitToplevel, absFile);
  return gitCommandSucceeds(gitToplevel, [
    "ls-files",
    "--error-unmatch",
    "--",
    relFromTop,
  ]);
}

async function gitStatus(
  rootDir: string,
  rel: string,
): Promise<{ ignored: boolean; tracked: boolean }> {
  const ignored = await gitCommandSucceeds(rootDir, [
    "check-ignore",
    "--no-index",
    "--quiet",
    "--",
    rel,
  ]);
  const tracked = await gitCommandSucceeds(rootDir, [
    "ls-files",
    "--error-unmatch",
    "--",
    rel,
  ]);
  return { ignored, tracked };
}

async function gitCommandSucceeds(
  rootDir: string,
  args: string[],
): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", rootDir, ...args], {
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

async function fallbackIgnored(rootDir: string, rel: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(join(rootDir, ".gitignore"), "utf8");
  } catch {
    return false;
  }

  let ignored = false;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    const pattern = (negated ? line.slice(1) : line).trim();
    if (matchesFallbackPattern(pattern, rel)) ignored = !negated;
  }
  return ignored;
}

function matchesFallbackPattern(pattern: string, rel: string): boolean {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\//, "");
  const target = rel.replaceAll("\\", "/");
  const subject = normalized.includes("/") ? target : basename(target);
  const regex = new RegExp(
    `^${normalized
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("**", "\u0000")
      .replaceAll("*", "[^/]*")
      .replaceAll("\u0000", ".*")
      .replaceAll("?", "[^/]")}$`,
  );
  return regex.test(subject);
}

function isEnvFamily(name: string): boolean {
  return name === ".env" || name.startsWith(".env.");
}

function isTemplate(name: string): boolean {
  return /^\.env\.(?:example|sample|template)(?:\.|$)/i.test(name);
}
