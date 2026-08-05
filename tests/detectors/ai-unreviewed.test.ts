import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createAiUnreviewedDetector,
  mergeRanges,
  parseAgentTraceJsonl,
  runAiUnreviewedScan,
  subtractRanges,
  unreviewedRangesForFile,
} from "../../src/detectors/ai-unreviewed/index.ts";
import { createScanContext } from "../../src/core/create-context.ts";

const FIXTURES = join(import.meta.dir, "../fixtures/ai-unreviewed");

describe("range math", () => {
  test("mergeRanges merges overlaps", () => {
    expect(mergeRanges([
      { start: 1, end: 5 },
      { start: 4, end: 8 },
      { start: 20, end: 22 },
    ])).toEqual([
      { start: 1, end: 8 },
      { start: 20, end: 22 },
    ]);
  });

  test("subtractRanges removes human-touched lines", () => {
    expect(
      subtractRanges(
        [{ start: 1, end: 40 }, { start: 50, end: 60 }],
        [{ start: 50, end: 60 }],
      ),
    ).toEqual([{ start: 1, end: 40 }]);
  });
});

describe("parseAgentTraceJsonl", () => {
  test("reads AI and human contributors", async () => {
    const raw = await Bun.file(
      join(FIXTURES, "with-trace/.agent-trace/traces.jsonl"),
    ).text();
    const files = parseAgentTraceJsonl(raw);
    expect(files.some((f) => f.file === "src/generated.ts")).toBe(true);
    const ranges = files.flatMap((f) => f.ranges);
    expect(ranges.some((r) => r.contributor === "ai")).toBe(true);
    expect(ranges.some((r) => r.contributor === "human")).toBe(true);
  });
});

describe("unreviewedRangesForFile", () => {
  test("AI minus human/mixed remains", () => {
    const { unreviewed } = unreviewedRangesForFile([
      {
        start: 1,
        end: 40,
        contributor: "ai",
        source: "agent-trace",
      },
      {
        start: 50,
        end: 60,
        contributor: "ai",
        source: "agent-trace",
      },
      {
        start: 50,
        end: 60,
        contributor: "human",
        source: "agent-trace",
      },
      {
        start: 70,
        end: 95,
        contributor: "ai",
        source: "agent-trace",
      },
    ]);
    expect(unreviewed).toEqual([
      { start: 1, end: 40 },
      { start: 70, end: 95 },
    ]);
  });
});

describe("runAiUnreviewedScan", () => {
  test("skips when no provenance", async () => {
    const result = await runAiUnreviewedScan(join(FIXTURES, "empty-project"));
    expect(result.skipped).toBeDefined();
    expect(result.findings).toHaveLength(0);
  });

  test("flags unreviewed AI from Agent Trace", async () => {
    const result = await runAiUnreviewedScan(join(FIXTURES, "with-trace"));
    expect(result.skipped).toBeUndefined();
    expect(result.provenanceSources.some((s) => s.includes("traces.jsonl"))).toBe(
      true,
    );
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const f = result.findings[0]!;
    expect(f.detectorId).toBe("ai-unreviewed");
    expect(f.file).toBe("src/generated.ts");
    expect(f.explanation).toContain("Provenance");
    expect(f.fixPrompt.length).toBeGreaterThan(40);
    // Lines 50-60 were human-touched — must not be the only remaining range
    const ranges = f.metadata?.unreviewedRanges as Array<{ start: number; end: number }>;
    expect(ranges.some((r) => r.start === 50 && r.end === 60)).toBe(false);
    expect(ranges.some((r) => r.start === 1 && r.end === 40)).toBe(true);
  });

  test("flags SPDX-AI-Disclosure ai-generated", async () => {
    const result = await runAiUnreviewedScan(join(FIXTURES, "with-spdx"));
    expect(result.skipped).toBeUndefined();
    expect(result.findings.some((f) => f.file?.endsWith("ai_module.py"))).toBe(
      true,
    );
  });

  test("detector.run calls skip when empty", async () => {
    const detector = createAiUnreviewedDetector();
    const { ctx, skips } = createScanContext({
      rootDir: join(FIXTURES, "empty-project"),
    });
    const findings = await detector.run(ctx);
    expect(findings).toHaveLength(0);
    expect(skips.some((s) => s.id === "ai-unreviewed")).toBe(true);
  });
});
