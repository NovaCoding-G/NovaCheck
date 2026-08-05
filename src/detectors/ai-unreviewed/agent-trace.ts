import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { AttributedRange, ContributorType, FileAttribution } from "./types.ts";

interface TraceContributor {
  type?: string;
  model_id?: string;
}

interface TraceRange {
  start_line?: number;
  end_line?: number;
  contributor?: TraceContributor;
}

interface TraceConversation {
  contributor?: TraceContributor;
  ranges?: TraceRange[];
}

interface TraceFile {
  path?: string;
  conversations?: TraceConversation[];
}

interface TraceRecord {
  version?: string;
  id?: string;
  files?: TraceFile[];
}

function asContributor(raw: string | undefined): ContributorType | undefined {
  if (raw === "human" || raw === "ai" || raw === "mixed" || raw === "unknown") {
    return raw;
  }
  return undefined;
}

/** Parse one Agent Trace record into attributed ranges. */
export function parseAgentTraceRecord(record: TraceRecord): FileAttribution[] {
  if (!record.files || !Array.isArray(record.files)) return [];
  const out: FileAttribution[] = [];

  for (const file of record.files) {
    if (!file.path || !file.conversations) continue;
    const ranges: AttributedRange[] = [];
    for (const conv of file.conversations) {
      const convType = asContributor(conv.contributor?.type) ?? "ai";
      const convModel = conv.contributor?.model_id;
      for (const r of conv.ranges ?? []) {
        const start = r.start_line;
        const end = r.end_line;
        if (
          typeof start !== "number" ||
          typeof end !== "number" ||
          start < 1 ||
          end < start
        ) {
          continue;
        }
        const type = asContributor(r.contributor?.type) ?? convType;
        ranges.push({
          start,
          end,
          contributor: type,
          modelId: r.contributor?.model_id ?? convModel,
          source: "agent-trace",
          traceId: record.id,
        });
      }
    }
    if (ranges.length > 0) {
      out.push({ file: file.path.replaceAll("\\", "/"), ranges });
    }
  }
  return out;
}

export function parseAgentTraceJsonl(content: string): FileAttribution[] {
  const out: FileAttribution[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as TraceRecord;
      out.push(...parseAgentTraceRecord(record));
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

function looksLikeTraceRecord(obj: unknown): obj is TraceRecord {
  if (!obj || typeof obj !== "object") return false;
  const r = obj as TraceRecord;
  return typeof r.version === "string" && Array.isArray(r.files);
}

/**
 * Load Agent Trace provenance from the conventional location used by the
 * reference implementation: `.agent-trace/traces.jsonl`, plus any `.json`
 * trace records in `.agent-trace/`.
 */
export async function loadAgentTrace(
  rootDir: string,
): Promise<{ attributions: FileAttribution[]; sources: string[] }> {
  const dir = join(rootDir, ".agent-trace");
  const sources: string[] = [];
  const attributions: FileAttribution[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { attributions, sources };
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = join(dir, entry.name);
    const rel = relative(rootDir, abs).replaceAll("\\", "/");

    if (entry.name.endsWith(".jsonl")) {
      try {
        const raw = await readFile(abs, "utf8");
        const parsed = parseAgentTraceJsonl(raw);
        if (parsed.length > 0) {
          sources.push(rel);
          attributions.push(...parsed);
        }
      } catch {
        // ignore
      }
      continue;
    }

    if (entry.name.endsWith(".json")) {
      try {
        const raw = await readFile(abs, "utf8");
        const obj = JSON.parse(raw) as unknown;
        if (!looksLikeTraceRecord(obj)) continue;
        const parsed = parseAgentTraceRecord(obj);
        if (parsed.length > 0) {
          sources.push(rel);
          attributions.push(...parsed);
        }
      } catch {
        // ignore
      }
    }
  }

  void stat;
  return { attributions, sources };
}
