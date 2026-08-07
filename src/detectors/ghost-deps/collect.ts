import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { DeclaredPackage, Ecosystem } from "./types.ts";
import { normalizePackageName } from "./heuristics.ts";
import { extractPyprojectDependencies } from "./parse-pyproject.ts";
import {
  isJsRuntimeBuiltin,
  isLocalPathSpecifier,
  isPythonBuiltin,
} from "./resolve/index.ts";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".novacheck",
]);

export interface GhostDepsWalkIssue {
  code: string;
  message: string;
  file: string;
}

async function walkFiles(
  root: string,
  onIssue?: (issue: GhostDepsWalkIssue) => void,
): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      const file = rel(root, dir) || ".";
      onIssue?.({
        code: "ghost-deps-walk-directory-failed",
        message: `Could not enumerate directory "${file}".`,
        file,
      });
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env") {
        if (IGNORE_DIRS.has(entry.name)) continue;
        if (entry.isDirectory()) continue;
      }
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }

  await walk(root);
  return out;
}

function rel(root: string, file: string): string {
  return relative(root, file).replaceAll("\\", "/");
}

function addPkg(
  map: Map<string, DeclaredPackage>,
  pkg: DeclaredPackage,
): void {
  const key = `${pkg.ecosystem}:${normalizePackageName(pkg.name, pkg.ecosystem)}`;
  const existing = map.get(key);
  // Prefer manifest declarations over imports for the same package.
  if (!existing || (existing.source === "import" && pkg.source === "manifest")) {
    map.set(key, pkg);
  }
}

async function collectFromPackageJson(
  root: string,
  file: string,
  map: Map<string, DeclaredPackage>,
): Promise<void> {
  const raw = await readFile(file, "utf8");
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }

  const sections = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const;

  for (const section of sections) {
    const deps = json[section];
    if (!deps || typeof deps !== "object") continue;
    for (const name of Object.keys(deps as Record<string, unknown>)) {
      const line = findLineContaining(raw, `"${name}"`);
      addPkg(map, {
        name,
        ecosystem: "npm",
        file: rel(root, file),
        line,
        source: "manifest",
        specifier: name,
      });
    }
  }
}

function findLineContaining(content: string, needle: string): number | undefined {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.includes(needle)) return i + 1;
  }
  return undefined;
}

function parseRequirementLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) return undefined;
  const match = trimmed.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
  return match?.[1];
}

async function collectFromRequirements(
  root: string,
  file: string,
  map: Map<string, DeclaredPackage>,
): Promise<void> {
  const raw = await readFile(file, "utf8");
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const name = parseRequirementLine(lines[i] ?? "");
    if (!name) continue;
    addPkg(map, {
      name,
      ecosystem: "pypi",
      file: rel(root, file),
      line: i + 1,
      source: "manifest",
      specifier: name,
    });
  }
}

async function collectFromPyproject(
  root: string,
  file: string,
  map: Map<string, DeclaredPackage>,
): Promise<void> {
  const raw = await readFile(file, "utf8");
  for (const { name, evidence } of extractPyprojectDependencies(raw)) {
    addPkg(map, {
      name,
      ecosystem: "pypi",
      file: rel(root, file),
      line: findLineContaining(raw, evidence) ?? findLineContaining(raw, name),
      source: "manifest",
      specifier: name,
    });
  }
}

/**
 * Extract bare package name from an import/require specifier.
 * Returns undefined for local paths and runtime builtins (Phase-1 early exclude).
 * Subpath imports (`#…`) are kept so the package-imports resolver can classify them.
 */
export function packageNameFromSpecifier(spec: string): string | undefined {
  if (!spec) return undefined;
  if (isLocalPathSpecifier(spec)) return undefined;
  if (isJsRuntimeBuiltin(spec)) return undefined;

  if (spec.startsWith("#")) {
    return spec.split("/")[0] || spec;
  }

  // Scoped: @scope/name[/...]
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    if (parts.length < 2) return undefined;
    // Path-alias style "@/..." is not a scoped npm package — keep full
    // specifier as name so tsconfig-paths can exclude it; registry won't match.
    if (parts[0] === "@" || parts[1] === "") {
      return spec;
    }
    return `${parts[0]}/${parts[1]}`;
  }

  return spec.split("/")[0];
}

const JS_IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+[\s\S]*?\s+from\s+|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

async function collectJsImports(
  root: string,
  file: string,
  map: Map<string, DeclaredPackage>,
): Promise<void> {
  const raw = await readFile(file, "utf8");
  let match: RegExpExecArray | null;
  const re = new RegExp(JS_IMPORT_RE.source, "g");
  while ((match = re.exec(raw)) !== null) {
    const spec = match[1];
    if (!spec) continue;
    const name = packageNameFromSpecifier(spec);
    if (!name) continue;
    const before = raw.slice(0, match.index);
    const line = before.split(/\r?\n/).length;
    addPkg(map, {
      name,
      ecosystem: "npm",
      file: rel(root, file),
      line,
      source: "import",
      specifier: spec,
    });
  }
}

const PY_IMPORT_RE =
  /^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import|import\s+([A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*))/;

async function collectPyImports(
  root: string,
  file: string,
  map: Map<string, DeclaredPackage>,
): Promise<void> {
  const raw = await readFile(file, "utf8");
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = line.match(PY_IMPORT_RE);
    if (!m) continue;
    const names: string[] = [];
    if (m[1]) names.push(m[1].split(".")[0] ?? m[1]);
    if (m[2]) {
      for (const part of m[2].split(",")) {
        const top = part.trim().split(/\s+as\s+/)[0]?.split(".")[0];
        if (top) names.push(top);
      }
    }
    for (const name of names) {
      if (!name || isPythonBuiltin(name)) continue;
      addPkg(map, {
        name,
        ecosystem: "pypi",
        file: rel(root, file),
        line: i + 1,
        source: "import",
        specifier: name,
      });
    }
  }
}

function isRequirementsFile(name: string): boolean {
  return (
    name === "requirements.txt" ||
    /^requirements[-_.].+\.txt$/i.test(name) ||
    name === "requirements-dev.txt"
  );
}

function isJsLike(name: string): boolean {
  return /\.(m?js|cjs|jsx|tsx|ts)$/i.test(name);
}

function isPy(name: string): boolean {
  return name.endsWith(".py");
}

export const GHOST_DEPS_DISCOVERY_PATTERNS = [
  "recursive walk (ignore: node_modules, .git, dist, build, .venv, …)",
  "manifests: package.json, requirements*.txt, pyproject.toml",
  "imports: .js .mjs .cjs .jsx .ts .tsx .py (not .d.ts)",
] as const;

export interface CollectPackagesResult {
  packages: DeclaredPackage[];
  filesReceived: number;
  filesAnalyzed: number;
  files: string[];
}

/**
 * Collect declared / imported packages from manifests and source.
 * Manifest wins over import for the same normalized name.
 * Phase-1 resolution (alias/workspace) runs later in analyze.
 */
export async function collectPackages(
  rootDir: string,
): Promise<DeclaredPackage[]> {
  const { packages } = await collectPackagesDetailed(rootDir);
  return packages;
}

export async function collectPackagesDetailed(
  rootDir: string,
  onIssue?: (issue: GhostDepsWalkIssue) => void,
): Promise<CollectPackagesResult> {
  const files = await walkFiles(rootDir, onIssue);
  const map = new Map<string, DeclaredPackage>();
  let filesAnalyzed = 0;

  for (const file of files) {
    const base = file.split(/[/\\]/).pop() ?? "";
    if (base === "package.json") {
      await collectFromPackageJson(rootDir, file, map);
      filesAnalyzed++;
    } else if (base === "pyproject.toml") {
      await collectFromPyproject(rootDir, file, map);
      filesAnalyzed++;
    } else if (isRequirementsFile(base)) {
      await collectFromRequirements(rootDir, file, map);
      filesAnalyzed++;
    }
  }

  for (const file of files) {
    const base = file.split(/[/\\]/).pop() ?? "";
    if (isJsLike(base) && !base.endsWith(".d.ts")) {
      await collectJsImports(rootDir, file, map);
      filesAnalyzed++;
    } else if (isPy(base)) {
      await collectPyImports(rootDir, file, map);
      filesAnalyzed++;
    }
  }

  return {
    packages: [...map.values()],
    filesReceived: files.length,
    filesAnalyzed,
    files,
  };
}

export function ecosystemLabel(ecosystem: Ecosystem): string {
  return ecosystem === "npm" ? "npm" : "PyPI";
}
