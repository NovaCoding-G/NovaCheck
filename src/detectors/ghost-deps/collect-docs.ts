import { readFile } from "node:fs/promises";
import type { DeclaredPackage, Ecosystem } from "./types.ts";

/**
 * Install commands written in prose are the earliest reachable form of a
 * hallucinated dependency: README, AGENTS.md and skill files are copied by
 * humans and executed by coding agents before any manifest or lockfile exists.
 */
export const AGENT_DOC_DISCOVERY_PATTERNS = [
  "docs & agent instructions: *.md, *.mdx, *.mdc, *.markdown, *.txt, *.yml, *.yaml, *.rules",
  "install commands: npm/pnpm/yarn/bun (install|i|add), npx, pnpx, bunx",
  "install commands: pip install, uv add, uv pip install, poetry add, pipx install",
] as const;

const DOC_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".mdc",
  ".markdown",
  ".txt",
  ".yml",
  ".yaml",
  ".rules",
]);

const DOC_BASENAMES = new Set([
  ".rules",
  ".windsurfrules",
  ".clinerules",
  ".aiderrules",
  ".agentrules",
]);

const JS_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const JS_INSTALL_SUBCOMMANDS = new Set(["install", "i", "add"]);
const JS_RUNNERS = new Set(["npx", "pnpx", "bunx"]);
const PY_MANAGERS = new Set(["pip", "pip3", "uv", "poetry", "pipx"]);

const ALL_COMMANDS = new Set([
  ...JS_MANAGERS,
  ...JS_RUNNERS,
  ...PY_MANAGERS,
]);

/** Flags that consume the next token (so a path is never read as a package). */
const FLAGS_WITH_VALUE = new Set([
  "-r",
  "--requirement",
  "-c",
  "--constraint",
  "-i",
  "--index-url",
  "--extra-index-url",
  "-f",
  "--find-links",
  "-t",
  "--target",
  "-e",
  "--editable",
  "--prefix",
  "--registry",
  "--python",
  "--cache-dir",
]);

/**
 * Generic words used in documentation as stand-ins for a real name.
 * Flagging them would be a false "ghost" on every tutorial.
 */
const PLACEHOLDER_NAMES = new Set([
  "package",
  "package-name",
  "packagename",
  "pkg",
  "pkg-name",
  "name",
  "module",
  "module-name",
  "library",
  "lib",
  "dependency",
  "dependencies",
  "deps",
  "dep",
  "something",
  "anything",
  "yourpackage",
  "yourpackagename",
  "mypackage",
  "some-package",
  "any-package",
  "the-package",
  "new-package",
  "other-package",
  "package1",
  "package2",
]);

const SKIP_SUFFIXES = [
  ".tgz",
  ".tar.gz",
  ".zip",
  ".whl",
  ".git",
  ".txt",
  ".json",
  ".toml",
  ".lock",
  ".yaml",
  ".yml",
];

const NPM_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const PYPI_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface DocInstallReference {
  name: string;
  ecosystem: Ecosystem;
  line: number;
  /** The install command as written, used as finding evidence. */
  command: string;
}

export function isAgentDocFile(basename: string): boolean {
  if (DOC_BASENAMES.has(basename)) return true;
  const dot = basename.lastIndexOf(".");
  if (dot <= 0) return false;
  return DOC_EXTENSIONS.has(basename.slice(dot).toLowerCase());
}

/** Strip markdown, prompt and quoting noise around a shell command. */
function cleanSegment(segment: string): string {
  return segment
    .replace(/^[\s>*+\-·•]+/, "")
    .replace(/^[`'"]+/, "")
    .replace(/^\$\s+/, "")
    .replace(/^(?:RUN|CMD|ENTRYPOINT|run:|command:)\s+/i, "")
    .replace(/[`'"]+$/, "")
    .trim();
}

/** Split a line into independent commands (`a && b`, `a; b`, `a | b`). */
function commandSegments(line: string): string[] {
  const withoutComment = line.replace(/\s+#\s.*$/, "");
  return withoutComment.split(/&&|\|\||;|\|/);
}

function isPlaceholder(token: string): boolean {
  if (/[<>{}[\]$%*?"'()=,]/.test(token)) return true;
  if (/^(your|my|some|any|the)[-_]/i.test(token)) return true;
  return PLACEHOLDER_NAMES.has(token.toLowerCase());
}

function looksLikePath(token: string): boolean {
  return (
    token === "." ||
    token === ".." ||
    token.startsWith("./") ||
    token.startsWith("../") ||
    token.startsWith("/") ||
    token.startsWith("~") ||
    token.includes("://") ||
    token.startsWith("git+") ||
    token.startsWith("file:") ||
    token.startsWith("github:") ||
    token.startsWith("npm:") ||
    token.startsWith("jsr:")
  );
}

function isVersionOnly(token: string): boolean {
  return /^[\^~=<>]/.test(token) || /^\d+(?:\.\d+)*$/.test(token);
}

/** `pkg@1.2.3` / `@scope/pkg@next` → bare npm name. */
export function npmNameFromToken(token: string): string | undefined {
  if (!token || token.startsWith("-")) return undefined;
  if (looksLikePath(token) || isVersionOnly(token)) return undefined;
  if (SKIP_SUFFIXES.some((suffix) => token.toLowerCase().endsWith(suffix))) {
    return undefined;
  }

  let name = token;
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash === -1) return undefined;
    const at = name.indexOf("@", slash);
    if (at !== -1) name = name.slice(0, at);
  } else {
    const at = name.indexOf("@");
    if (at > 0) name = name.slice(0, at);
  }

  if (!name || isPlaceholder(name) || !NPM_NAME_RE.test(name)) return undefined;
  if (!name.startsWith("@") && name.includes("/")) return undefined;
  return name;
}

/** `pkg==1.0`, `pkg[extra]`, `pkg>=2` → bare PyPI name. */
export function pypiNameFromToken(token: string): string | undefined {
  if (!token || token.startsWith("-")) return undefined;
  if (looksLikePath(token) || isVersionOnly(token)) return undefined;
  if (SKIP_SUFFIXES.some((suffix) => token.toLowerCase().endsWith(suffix))) {
    return undefined;
  }

  const name = token.split(/[[=<>!~;]/)[0]?.trim();
  if (!name || isPlaceholder(name) || !PYPI_NAME_RE.test(name)) return undefined;
  return name;
}

function tokenize(rest: string): string[] {
  return rest.split(/\s+/).filter((token) => token.length > 0);
}

function packagesFromTokens(
  tokens: string[],
  ecosystem: Ecosystem,
  firstOnly: boolean,
): string[] {
  const names: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (FLAGS_WITH_VALUE.has(token)) {
      i++;
      continue;
    }
    if (token.startsWith("-")) continue;
    const name =
      ecosystem === "npm"
        ? npmNameFromToken(token)
        : pypiNameFromToken(token);
    if (!name) {
      // A runner's package is always its first positional argument.
      if (firstOnly) break;
      continue;
    }
    names.push(name);
    if (firstOnly) break;
  }
  return names;
}

function parseSegment(
  segment: string,
): { ecosystem: Ecosystem; names: string[] } | undefined {
  const cleaned = cleanSegment(segment);
  if (!cleaned) return undefined;

  const tokens = tokenize(cleaned);
  const command = tokens[0]?.toLowerCase();
  if (!command || !ALL_COMMANDS.has(command)) return undefined;

  const rest = tokens.slice(1);

  if (JS_RUNNERS.has(command)) {
    return { ecosystem: "npm", names: packagesFromTokens(rest, "npm", true) };
  }

  if (JS_MANAGERS.has(command)) {
    const sub = rest[0]?.toLowerCase();
    if (!sub || !JS_INSTALL_SUBCOMMANDS.has(sub)) return undefined;
    return {
      ecosystem: "npm",
      names: packagesFromTokens(rest.slice(1), "npm", false),
    };
  }

  if (command === "uv") {
    if (rest[0] === "add") {
      return {
        ecosystem: "pypi",
        names: packagesFromTokens(rest.slice(1), "pypi", false),
      };
    }
    if (rest[0] === "pip" && rest[1] === "install") {
      return {
        ecosystem: "pypi",
        names: packagesFromTokens(rest.slice(2), "pypi", false),
      };
    }
    return undefined;
  }

  const sub = rest[0]?.toLowerCase();
  const expected = command === "poetry" ? "add" : "install";
  if (sub !== expected) return undefined;
  return {
    ecosystem: "pypi",
    names: packagesFromTokens(rest.slice(1), "pypi", false),
  };
}

/** Extract every package an install command in this text would install. */
export function extractInstallPackages(content: string): DocInstallReference[] {
  const out: DocInstallReference[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length > 500) continue;
    if (!/(?:npm|pnpm|yarn|bun|npx|pnpx|bunx|pip3?|uv|poetry|pipx)\s/.test(line)) {
      continue;
    }
    for (const segment of commandSegments(line)) {
      const parsed = parseSegment(segment);
      if (!parsed) continue;
      for (const name of parsed.names) {
        const key = `${parsed.ecosystem}:${name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          name,
          ecosystem: parsed.ecosystem,
          line: i + 1,
          command: cleanSegment(segment).slice(0, 120),
        });
      }
    }
  }

  return out;
}

/** Max doc size we parse: instructions are prose, not data dumps. */
const MAX_DOC_BYTES = 512 * 1024;

export async function collectDocInstallPackages(
  file: string,
  relFile: string,
): Promise<DeclaredPackage[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return [];
  }
  if (raw.length > MAX_DOC_BYTES) return [];

  return extractInstallPackages(raw).map((reference) => ({
    name: reference.name,
    ecosystem: reference.ecosystem,
    file: relFile,
    line: reference.line,
    source: "docs" as const,
    specifier: reference.name,
    command: reference.command,
  }));
}
