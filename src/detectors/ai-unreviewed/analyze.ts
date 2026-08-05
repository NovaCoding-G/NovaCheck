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
      models.length > 0 ? ` Modelli: ${models.join(", ")}.` : "";
    const sourcesUsed = [
      ...new Set(ranges.map((r) => r.source)),
    ].join(", ");

    findings.push({
      id: `ai-unreviewed:${file}:${unreviewed[0]!.start}-${unreviewed[unreviewed.length - 1]!.end}`,
      detectorId: "ai-unreviewed",
      severity,
      title: `${lines} righe AI senza tocco umano: ${file}`,
      explanation:
        `La provenance (${sourcesUsed}) attribuisce all'AI le righe ${rangeLabel} in \`${file}\`, ` +
        `e nessun range successivo le marca come human/mixed.${modelNote} ` +
        `Codice AI mai rivisto da un umano è la causa tipica di bug sottili, segreti leftover e sink pericolosi ` +
        `che sfuggono prima della pubblicazione.`,
      fixPrompt:
        `Rivedi manualmente le righe ${rangeLabel} in ${file} (provenance: AI, non ancora human/mixed). ` +
        `Controlla correttezza, sicurezza e edge case. Dopo la review, aggiorna la provenance ` +
        `(es. Agent Trace con contributor human/mixed sulle righe toccate) oppure applica le modifiche necessarie. ` +
        `Non pubblicare codice AI non letto.`,
      file,
      line: unreviewed[0]!.start,
      evidence: `L${rangeLabel} (${lines} righe)`,
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
