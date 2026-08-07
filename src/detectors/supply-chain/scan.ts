import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Finding } from "../../types/index.ts";

const DANGEROUS_SCRIPT_RE =
  /curl\s+[^\n|]*\|\s*(?:ba)?sh|wget\s+[^\n|]*\|\s*(?:ba)?sh|invoke-expression|iex\s*\(|DownloadString/i;

const HTTP_GIT_RE = /^git\+http:\/\//i;

export const SUPPLY_CHAIN_PATTERNS = [
  "package.json scripts (preinstall/install/postinstall/prepare)",
  "dependency URLs (git+http://)",
] as const;

export interface SupplyChainScanResult {
  findings: Finding[];
  filesReceived: number;
  filesAnalyzed: number;
  files: string[];
  discoveryPatterns: string[];
}

export async function runSupplyChainScan(
  rootDir: string,
): Promise<SupplyChainScanResult> {
  const findings: Finding[] = [];
  const files: string[] = [];
  const pkgPath = join(rootDir, "package.json");

  let raw: string;
  try {
    raw = await readFile(pkgPath, "utf8");
    files.push(pkgPath);
  } catch {
    return {
      findings: [],
      filesReceived: 0,
      filesAnalyzed: 0,
      files: [],
      discoveryPatterns: [...SUPPLY_CHAIN_PATTERNS],
    };
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {
      findings: [],
      filesReceived: 1,
      filesAnalyzed: 0,
      files,
      discoveryPatterns: [...SUPPLY_CHAIN_PATTERNS],
    };
  }

  const scripts = json.scripts;
  if (scripts && typeof scripts === "object") {
    for (const [name, value] of Object.entries(
      scripts as Record<string, unknown>,
    )) {
      if (typeof value !== "string") continue;
      const isLifecycle =
        /^(pre|post)?(install|prepare|publish)$/i.test(name);
      if (DANGEROUS_SCRIPT_RE.test(value)) {
        const line = lineOfKey(raw, `"${name}"`);
        findings.push({
          id: `supply-chain:script:${name}`,
          detectorId: "supply-chain",
          severity: isLifecycle ? "critical" : "high",
          title: `Dangerous npm script: ${name}`,
          explanation:
            `The \`${name}\` script executes a pattern commonly used in supply-chain attacks ` +
            `(for example curl|bash or remote downloads) and can install malware during \`npm install\`.`,
          fixPrompt:
            `Review and remove the "${name}" script from package.json unless it is strictly required. ` +
            `Do not download or execute remote payloads in lifecycle scripts. Prefer versioned registry dependencies.`,
          file: "package.json",
          line,
          evidence: `${name}: ${value.slice(0, 80)}`,
          metadata: { script: name },
        });
      }
    }
  }

  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ] as const) {
    const deps = json[section];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, version] of Object.entries(
      deps as Record<string, unknown>,
    )) {
      if (typeof version !== "string") continue;
      if (HTTP_GIT_RE.test(version)) {
        findings.push({
          id: `supply-chain:git-http:${name}`,
          detectorId: "supply-chain",
          severity: "high",
          title: `Git dependency uses unencrypted HTTP: ${name}`,
          explanation:
            `The \`${name}\` dependency points to a Git repository over \`http://\` instead of HTTPS. ` +
            `A man-in-the-middle attacker could replace the downloaded code.`,
          fixPrompt:
            `In package.json, change "${name}" from git+http:// to git+https://, ` +
            `or use a version published on npm with a semver range.`,
          file: "package.json",
          line: lineOfKey(raw, `"${name}"`),
          evidence: `${name}: ${version}`,
          metadata: { package: name, version },
        });
      }
    }
  }

  return {
    findings,
    filesReceived: 1,
    filesAnalyzed: 1,
    files,
    discoveryPatterns: [...SUPPLY_CHAIN_PATTERNS],
  };
}

function lineOfKey(content: string, needle: string): number | undefined {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.includes(needle)) return i + 1;
  }
  return undefined;
}
