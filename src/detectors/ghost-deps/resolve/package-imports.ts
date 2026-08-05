import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImportMapEntry } from "./types.ts";
import { matchPathPattern } from "./pattern-match.ts";

/**
 * Read package.json "imports" (subpath imports, typically `#…`).
 */
export async function loadPackageImports(
  rootDir: string,
): Promise<{ entries: ImportMapEntry[]; present: boolean }> {
  try {
    const raw = await readFile(join(rootDir, "package.json"), "utf8");
    const json = JSON.parse(raw) as { imports?: Record<string, unknown> };
    if (!json.imports || typeof json.imports !== "object") {
      return { entries: [], present: false };
    }
    return {
      present: true,
      entries: Object.keys(json.imports).map((pattern) => ({ pattern })),
    };
  } catch {
    return { entries: [], present: false };
  }
}

export function matchesPackageImports(
  specifier: string,
  entries: ImportMapEntry[],
): string | undefined {
  // Subpath imports are usually `#…`; still match any configured key.
  for (const entry of entries) {
    if (matchPathPattern(entry.pattern, specifier)) {
      return entry.pattern;
    }
  }
  return undefined;
}
