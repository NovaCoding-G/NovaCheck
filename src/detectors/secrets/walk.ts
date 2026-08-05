import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

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
  ".cache",
  "vendor",
]);

/** Extensions we never scan (binary / generated / lock noise). */
const SKIP_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".pdf",
  ".wasm",
  ".map",
  ".lock",
  ".pyc",
  ".class",
  ".o",
  ".so",
  ".dll",
  ".exe",
]);

const SKIP_BASENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "composer.lock",
]);

/** Default max file size: 512 KiB — secrets in huge dumps are rare and noisy. */
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024;

/** Human-readable discovery rules for --verbose. */
export const TEXT_FILE_DISCOVERY_PATTERNS = [
  "recursive walk from project root",
  "ignore dirs: node_modules, .git, dist, build, out, .next, .nuxt, coverage, __pycache__, .venv, venv, .tox, .novacheck, .cache, vendor",
  "skip binary/lock extensions (.png, .wasm, .lock, …)",
  "skip lockfile basenames (package-lock.json, bun.lock, …)",
  "max file size 512 KiB",
  "include .github / .vscode / .idea; skip other dotdirs",
] as const;

export async function listTextFiles(
  rootDir: string,
  maxBytes = DEFAULT_MAX_FILE_BYTES,
): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.isDirectory()) {
        // Allow scanning .env* files at any level; skip other dotdirs.
        if (
          entry.name !== ".github" &&
          entry.name !== ".vscode" &&
          entry.name !== ".idea"
        ) {
          continue;
        }
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_BASENAMES.has(entry.name)) continue;
      const ext = extname(entry.name).toLowerCase();
      if (SKIP_EXT.has(ext)) continue;

      try {
        const s = await stat(full);
        if (s.size === 0 || s.size > maxBytes) continue;
      } catch {
        continue;
      }
      out.push(full);
    }
  }

  await walk(rootDir);
  return out;
}

export function toRel(rootDir: string, file: string): string {
  return relative(rootDir, file).replaceAll("\\", "/");
}
