import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * Minimal pnpm-workspace.yaml reader — only the `packages:` list of globs.
 */
export function parsePnpmWorkspacePackages(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const out: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages\s*:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      if (/^\S/.test(line) && !/^\s/.test(line)) break;
      const m = line.match(/^\s*-\s+['"]?([^'"]+)['"]?\s*$/);
      if (m?.[1]) out.push(m[1]);
    }
  }
  return out;
}

async function readWorkspaceGlobs(rootDir: string): Promise<string[]> {
  const globs: string[] = [];

  try {
    const raw = await readFile(join(rootDir, "package.json"), "utf8");
    const json = JSON.parse(raw) as {
      workspaces?: string[] | { packages?: string[] };
    };
    if (Array.isArray(json.workspaces)) {
      globs.push(...json.workspaces);
    } else if (json.workspaces?.packages) {
      globs.push(...json.workspaces.packages);
    }
  } catch {
    // no root package.json
  }

  try {
    const yaml = await readFile(join(rootDir, "pnpm-workspace.yaml"), "utf8");
    globs.push(...parsePnpmWorkspacePackages(yaml));
  } catch {
    // no pnpm workspace
  }

  return [...new Set(globs)];
}

/**
 * Expand a single workspace glob like "packages/*" or "apps/**" into directories
 * that contain a package.json. Only `*` / `**` path segments are supported.
 */
async function expandGlob(rootDir: string, glob: string): Promise<string[]> {
  const normalized = glob.replaceAll("\\", "/").replace(/\/$/, "");
  const parts = normalized.split("/");
  const matches: string[] = [];

  async function walk(dir: string, partIndex: number): Promise<void> {
    if (partIndex >= parts.length) {
      try {
        await readFile(join(dir, "package.json"), "utf8");
        matches.push(dir);
      } catch {
        // not a package
      }
      return;
    }

    const part = parts[partIndex]!;
    if (part === "**") {
      // match zero or more directories
      await walk(dir, partIndex + 1);
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(join(dir, entry.name), partIndex);
      }
      return;
    }

    if (part === "*") {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(join(dir, entry.name), partIndex + 1);
      }
      return;
    }

    // literal segment
    const next = join(dir, part);
    try {
      const s = await stat(next);
      if (s.isDirectory()) await walk(next, partIndex + 1);
    } catch {
      // missing
    }
  }

  await walk(rootDir, 0);
  return matches;
}

export async function loadWorkspacePackageNames(
  rootDir: string,
): Promise<{ names: Set<string>; globs: string[] }> {
  const globs = await readWorkspaceGlobs(rootDir);
  const names = new Set<string>();

  for (const glob of globs) {
    const dirs = await expandGlob(rootDir, glob);
    for (const dir of dirs) {
      try {
        const raw = await readFile(join(dir, "package.json"), "utf8");
        const json = JSON.parse(raw) as { name?: string };
        if (json.name) names.add(json.name);
      } catch {
        // ignore broken package.json
      }
      void relative;
    }
  }

  return { names, globs };
}

export function isWorkspacePackage(
  packageName: string,
  workspacePackages: Set<string>,
): boolean {
  return workspacePackages.has(packageName);
}
