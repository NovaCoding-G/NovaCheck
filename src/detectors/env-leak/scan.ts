import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { Finding } from "../../types/index.ts";
import { listTextFiles, toRel } from "../secrets/walk.ts";

const execFileAsync = promisify(execFile);

export const ENV_LEAK_PATTERNS = [
  "recursive .env / .env.* discovery",
  "git check-ignore + git ls-files per file",
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
  const gitRepo = await isGitRepository(rootDir);

  for (const abs of files) {
    const rel = toRel(rootDir, abs);
    const status = gitRepo
      ? await gitStatus(rootDir, rel)
      : {
          ignored: await fallbackIgnored(rootDir, rel),
          tracked: false,
        };
    if (status.ignored && !status.tracked) continue;

    findings.push({
      id: `env-leak:present:${rel}`,
      detectorId: "env-leak",
      severity: "critical",
      title: status.tracked
        ? `${rel} contiene configurazione sensibile ed è tracciato da Git`
        : `${rel} non è protetto da .gitignore`,
      explanation: status.tracked
        ? `Il file \`${rel}\` è già tracciato da Git. Aggiungerlo a .gitignore non lo rimuove dalla history e le credenziali vanno considerate compromesse.`
        : `È presente \`${rel}\`, ma Git non lo ignora. Può essere committato e pubblicare credenziali reali.`,
      fixPrompt: status.tracked
        ? `Rimuovi ${rel} dall'indice e dalla history Git, aggiungilo a .gitignore e ruota tutte le credenziali contenute. Mantieni solo template con placeholder.`
        : `Aggiungi una regola che ignori ${rel} (o tutti i file .env*) a .gitignore, mantenendo solo i template. Non committare il file.`,
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

async function isGitRepository(rootDir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", rootDir, "rev-parse", "--is-inside-work-tree"],
      { encoding: "utf8" },
    );
    return stdout.trim() === "true";
  } catch {
    return false;
  }
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
