import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const CONFIG_NAMES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
  "vite.config.mts",
  "webpack.config.js",
  "webpack.config.ts",
  "webpack.config.mjs",
  "webpack.config.cjs",
  "rspack.config.js",
  "rspack.config.ts",
  "rollup.config.js",
  "rollup.config.ts",
  "rollup.config.mjs",
];

/**
 * Detect bundler alias configs we do not evaluate yet.
 * Presence of `resolve.alias` / `alias:` in known config files → blind mode
 * for import-only registry misses.
 */
export async function detectUnevaluatedBundlerAliases(
  rootDir: string,
): Promise<{ hasUnevaluated: boolean; configs: string[] }> {
  const configs: string[] = [];

  // Root-level well-known names
  for (const name of CONFIG_NAMES) {
    const file = join(rootDir, name);
    if (await fileHasAliasConfig(file)) {
      configs.push(name);
    }
  }

  // Also scan one level of common folders (e.g. config/vite.config.ts) lightly
  for (const sub of ["config", "configs"]) {
    let entries;
    try {
      entries = await readdir(join(rootDir, sub), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!CONFIG_NAMES.includes(entry.name) && !/vite\.config\./.test(entry.name)) {
        continue;
      }
      const rel = `${sub}/${entry.name}`;
      if (await fileHasAliasConfig(join(rootDir, sub, entry.name))) {
        configs.push(rel);
      }
    }
  }

  void relative;
  return { hasUnevaluated: configs.length > 0, configs };
}

async function fileHasAliasConfig(file: string): Promise<boolean> {
  try {
    const raw = await readFile(file, "utf8");
    // High-signal patterns only — avoid matching random "alias" comments.
    return (
      /resolve\s*:\s*\{[\s\S]{0,400}?alias\s*:/.test(raw) ||
      /alias\s*:\s*\{/.test(raw) ||
      /alias\s*:\s*\[/.test(raw) ||
      /\.alias\s*=/.test(raw)
    );
  } catch {
    return false;
  }
}
