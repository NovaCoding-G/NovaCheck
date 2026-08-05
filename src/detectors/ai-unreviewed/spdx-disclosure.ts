import { readFile } from "node:fs/promises";
import { listTextFiles, toRel } from "../secrets/walk.ts";
import type { FileAttribution } from "./types.ts";

/**
 * SPDX-AI-Disclosure convention (ai-disclosure / W3C vocabulary in SPDX tags).
 * Only treat explicit `ai-generated` as AI provenance for unreviewed detection.
 * `ai-assisted` / `mixed` are weaker signals — skipped for precision.
 */
const DISCLOSURE_RE =
  /^\s*(?:(?:(?:\/\/|#|\/\*+|\*)\s*)?)SPDX-AI-Disclosure:\s*(ai-generated)\b/im;
const REVIEWED_RE =
  /^\s*(?:(?:(?:\/\/|#|\/\*+|\*)\s*)?)SPDX-AI-(?:Reviewed|ReviewStatus|Human-Reviewed):\s*(?:yes|true|reviewed|human)\b/im;

export async function loadSpdxAiDisclosure(
  rootDir: string,
): Promise<{ attributions: FileAttribution[]; sources: string[] }> {
  const files = await listTextFiles(rootDir);
  const attributions: FileAttribution[] = [];
  const sources: string[] = [];

  for (const abs of files) {
    // Only need the header — read first ~4KB
    let raw: string;
    try {
      const buf = await readFile(abs);
      raw = buf.subarray(0, Math.min(buf.length, 4096)).toString("utf8");
    } catch {
      continue;
    }

    if (!DISCLOSURE_RE.test(raw)) continue;
    if (REVIEWED_RE.test(raw)) continue;

    const rel = toRel(rootDir, abs);
    // Count lines in full file for range end
    let lineCount = 1;
    try {
      const full = await readFile(abs, "utf8");
      lineCount = full.split(/\r?\n/).length;
    } catch {
      lineCount = 1;
    }

    sources.push(rel);
    attributions.push({
      file: rel,
      ranges: [
        {
          start: 1,
          end: Math.max(1, lineCount),
          contributor: "ai",
          source: "spdx-ai-disclosure",
        },
      ],
    });
  }

  return { attributions, sources };
}
