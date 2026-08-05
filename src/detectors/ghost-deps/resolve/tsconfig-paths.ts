import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { TsPathEntry } from "./types.ts";
import { matchPathPattern } from "./pattern-match.ts";

/** Strip line and block comments enough for tsconfig JSONC. */
export function stripJsonComments(raw: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let quote = "";
  while (i < raw.length) {
    const ch = raw[i]!;
    const next = raw[i + 1];

    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < raw.length) {
        out += raw[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === quote) inString = false;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < raw.length && raw[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i + 1 < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // Trailing commas before } or ]
    if (ch === ",") {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j]!)) j++;
      if (raw[j] === "}" || raw[j] === "]") {
        i++;
        continue;
      }
    }

    out += ch;
    i++;
  }
  return out;
}

interface TsconfigShape {
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
  extends?: string | string[];
}

async function readTsconfigFile(file: string): Promise<TsconfigShape | undefined> {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(stripJsonComments(raw)) as TsconfigShape;
  } catch {
    return undefined;
  }
}

/**
 * Load path aliases from tsconfig.json / jsconfig.json at project root.
 * Does not fully resolve `extends` chains (only the root file) — good enough
 * for high-precision exclusion of obvious aliases.
 */
export async function loadTsPathEntries(
  rootDir: string,
): Promise<{ entries: TsPathEntry[]; configFile?: string }> {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const file = join(rootDir, name);
    const json = await readTsconfigFile(file);
    if (!json?.compilerOptions) continue;

    const baseUrl = json.compilerOptions.baseUrl ?? ".";
    const paths = json.compilerOptions.paths ?? {};
    const entries: TsPathEntry[] = Object.keys(paths).map((pattern) => ({
      pattern,
      baseUrl: baseUrl.replaceAll("\\", "/"),
    }));

    // baseUrl alone: bare non-relative imports can resolve under baseUrl.
    // We only use explicit paths keys for exclusion (precision).
    if (entries.length > 0) {
      return { entries, configFile: relative(rootDir, file).replaceAll("\\", "/") };
    }

    // If only baseUrl is set without paths, we do not treat every bare import
    // as local — that would hide real ghost deps. Skip.
    void dirname;
  }
  return { entries: [] };
}

export function matchesTsPaths(specifier: string, entries: TsPathEntry[]): string | undefined {
  for (const entry of entries) {
    if (matchPathPattern(entry.pattern, specifier)) {
      return entry.pattern;
    }
  }
  return undefined;
}
