import type { Finding, Severity } from "../../types/index.ts";
import { formatRanges, mergeRanges, rangeLineCount, subtractRanges } from "./ranges.ts";
import type { AttributedRange, FileAttribution, LineRange } from "./types.ts";

function severityForLines(lines: number): Severity {
  if (lines >= 80) return "medium";
  if (lines >= 20) return "low";
  return "info";
}

/**
 * AI ranges not overlapped by human/mixed attribution = unreviewed AI code.
 * `mixed` counts as human-touched (someone edited the AI output).
 */
export function unreviewedRangesForFile(
  ranges: AttributedRange[],
): { unreviewed: LineRange[]; models: string[] } {
  const ai = ranges
    .filter((r) => r.contributor === "ai")
    .map((r) => ({ start: r.start, end: r.end }));
  const humanTouch = ranges
    .filter((r) => r.contributor === "human" || r.contributor === "mixed")
    .map((r) => ({ start: r.start, end: r.end }));

  const unreviewed = subtractRanges(mergeRanges(ai), humanTouch);
  const models = [
    ...new Set(
      ranges
        .filter((r) => r.contributor === "ai" && r.modelId)
        .map((r) => r.modelId!),
    ),
  ];
  return { unreviewed, models };
}

export function mergeFileAttributions(
  batches: FileAttribution[],
): Map<string, AttributedRange[]> {
  const map = new Map<string, AttributedRange[]>();
  for (const batch of batches) {
    const key = batch.file.replaceAll("\\", "/");
    const existing = map.get(key) ?? [];
    existing.push(...batch.ranges);
    map.set(key, existing);
  }
  return map;
}

export function findingsFromAttributions(
  files: FileAttribution[],
  provenanceSources: string[],
): Finding[] {
  const byFile = mergeFileAttributions(files);
  const findings: Finding[] = [];

  for (const [file, ranges] of byFile) {
    const { unreviewed, models } = unreviewedRangesForFile(ranges);
    if (unreviewed.length === 0) continue;

    const lines = rangeLineCount(unreviewed);
    const severity = severityForLines(lines);
    const rangeLabel = formatRanges(unreviewed);
    const modelNote =
      models.length > 0 ? ` Models: ${models.join(", ")}.` : "";
    const sourcesUsed = [
      ...new Set(ranges.map((r) => r.source)),
    ].join(", ");

    findings.push({
      id: `ai-unreviewed:${file}:${unreviewed[0]!.start}-${unreviewed[unreviewed.length - 1]!.end}`,
      detectorId: "ai-unreviewed",
      severity,
      title: `${lines} AI-authored lines without human review: ${file}`,
      explanation:
        `Provenance (${sourcesUsed}) attributes lines ${rangeLabel} in \`${file}\` to AI, ` +
        `and no later range marks them as human or mixed.${modelNote} ` +
        `AI code that has never been reviewed by a human is a common source of subtle bugs, leftover secrets, ` +
        `and dangerous sinks that escape before shipping.`,
      fixPrompt:
        `Manually review lines ${rangeLabel} in ${file} (provenance: AI, not yet human/mixed). ` +
        `Check correctness, security, and edge cases. After review, update provenance ` +
        `(for example Agent Trace with a human/mixed contributor on reviewed lines) or apply the necessary changes. ` +
        `Do not ship unread AI-generated code.`,
      file,
      line: unreviewed[0]!.start,
      evidence: `L${rangeLabel} (${lines} lines)`,
      metadata: {
        engine: sourcesUsed,
        provenanceSources,
        unreviewedRanges: unreviewed,
        lineCount: lines,
        models,
      },
    });
  }

  // Prefer fewer, higher-signal findings: drop pure info if we already have low+
  const hasActionable = findings.some(
    (f) => f.severity === "medium" || f.severity === "low",
  );
  if (hasActionable) {
    return findings.filter((f) => f.severity !== "info");
  }
  return findings;
}
