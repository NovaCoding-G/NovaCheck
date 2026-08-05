/**
 * Runtime builtins that must never become registry findings.
 * Precision-first: only well-known stdlib / runtime modules.
 */

const NODE_CORE = [
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
] as const;

/** Bun-specific built-in module names (without bun: prefix). */
const BUN_CORE = ["bun", "sqlite", "ffi", "jsc", "test"] as const;

/** Deno top-level std-ish builtins commonly imported as bare specifiers. */
const DENO_CORE = ["deno"] as const;

export const NODE_BUILTINS: ReadonlySet<string> = new Set([
  ...NODE_CORE,
  ...NODE_CORE.map((m) => `node:${m}`),
  "node:test",
  "node:fs/promises",
  "node:dns/promises",
  "node:stream/promises",
  "node:timers/promises",
  "node:readline/promises",
  "fs/promises",
  "dns/promises",
  "stream/promises",
  "timers/promises",
  "readline/promises",
]);

export const BUN_BUILTINS: ReadonlySet<string> = new Set([
  ...BUN_CORE.map((m) => `bun:${m}`),
  "bun:sqlite",
  "bun:test",
  "bun:ffi",
]);

export const DENO_BUILTINS: ReadonlySet<string> = new Set([
  ...DENO_CORE,
  "deno",
]);

/** Common Python stdlib top-level modules — skip import checks for these. */
export const PY_STDLIB: ReadonlySet<string> = new Set([
  "abc",
  "argparse",
  "array",
  "asyncio",
  "base64",
  "bisect",
  "builtins",
  "calendar",
  "collections",
  "contextlib",
  "copy",
  "csv",
  "ctypes",
  "dataclasses",
  "datetime",
  "decimal",
  "enum",
  "functools",
  "gc",
  "getpass",
  "glob",
  "hashlib",
  "heapq",
  "hmac",
  "html",
  "http",
  "importlib",
  "inspect",
  "io",
  "itertools",
  "json",
  "logging",
  "math",
  "multiprocessing",
  "operator",
  "os",
  "pathlib",
  "pickle",
  "platform",
  "pprint",
  "queue",
  "random",
  "re",
  "secrets",
  "shutil",
  "signal",
  "socket",
  "sqlite3",
  "ssl",
  "statistics",
  "string",
  "struct",
  "subprocess",
  "sys",
  "tempfile",
  "threading",
  "time",
  "timeit",
  "traceback",
  "typing",
  "unittest",
  "urllib",
  "uuid",
  "warnings",
  "weakref",
  "xml",
  "zipfile",
  "zlib",
]);

export function isJsRuntimeBuiltin(spec: string): boolean {
  const s = spec.trim();
  if (!s) return false;
  if (s.startsWith("node:")) return true;
  if (s.startsWith("bun:")) return true;
  if (s.startsWith("deno:")) return true;
  if (NODE_BUILTINS.has(s)) return true;
  if (BUN_BUILTINS.has(s)) return true;
  if (DENO_BUILTINS.has(s)) return true;
  return false;
}

export function isPythonBuiltin(name: string): boolean {
  return PY_STDLIB.has(name);
}
