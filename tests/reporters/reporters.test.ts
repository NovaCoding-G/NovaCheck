import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScan } from "../../src/core/scan.ts";
import { formatBadgeMarkdown, formatBadgeSvg } from "../../src/reporters/badge.ts";
import { formatHtmlReport } from "../../src/reporters/html.ts";
import { formatTerminalReport } from "../../src/reporters/terminal.ts";
import type { Detector, ScanResult } from "../../src/types/index.ts";

function fakeResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    trustScore: 63,
    findings: [
      {
        id: "t1",
        detectorId: "secrets",
        severity: "critical",
        title: "Exposed secret",
        explanation: "An API key is stored in plaintext source code.",
        fixPrompt: "Move the key to an environment variable and rotate it.",
        file: "src/config.ts",
        line: 12,
      },
      {
        id: "t2",
        detectorId: "ghost-deps",
        severity: "high",
        title: "Ghost package",
        explanation: "The dependency does not exist on the registry.",
        fixPrompt: "Remove the dependency or correct its package name.",
        file: "package.json",
        line: 6,
      },
    ],
    detectorsRun: ["ghost-deps", "secrets"],
    detectorsSkipped: [
      { id: "ai-unreviewed", reason: "No provenance found" },
    ],
    diagnostics: {
      incomplete: false,
      issues: [],
      detectors: [
        {
          detectorId: "ghost-deps",
          name: "Ghost dependencies",
          status: "ran",
          filesReceived: 2,
          filesAnalyzed: 1,
          discoveryPatterns: ["manifests"],
          findingsCount: 1,
        },
        {
          detectorId: "secrets",
          name: "Secrets",
          status: "ran",
          filesReceived: 3,
          filesAnalyzed: 3,
          discoveryPatterns: ["text walk"],
          findingsCount: 1,
        },
      ],
      totalFilesReceived: 5,
      uniqueFilesTouched: 4,
      discoveryPatterns: ["manifests", "text walk"],
    },
    scannedAt: "2026-07-16T12:00:00.000Z",
    rootDir: "/tmp/demo",
    durationMs: 42,
    ...overrides,
  };
}

describe("reporters", () => {
  test("terminal highlights Trust Score and top issues", () => {
    const text = formatTerminalReport(fakeResult());
    expect(text).toContain("Trust Score");
    expect(text).toContain("63/100");
    expect(text).toContain("BLOCKED");
    expect(text).toContain("Priority risks");
    expect(text).toContain("Exposed secret");
    expect(text).toContain("Risk");
    expect(text).toContain("Recommended fix");
    expect(text).toContain("Partial coverage");
  });

  test("verbose prints detector diagnostics before findings", () => {
    const text = formatTerminalReport(fakeResult(), { verbose: true });
    expect(text).toContain("Diagnostics (--verbose)");
    expect(text).toContain("ghost-deps");
    expect(text).toContain("files received:");
    expect(text).toContain("analyzed:");
    expect(text).toContain("Discovery patterns");
  });

  test("separates informational AI signals from actionable risks", () => {
    const info = formatTerminalReport(
      fakeResult({
        trustScore: 100,
        findings: [
          {
            id: "ai-presence:marker",
            detectorId: "ai-presence",
            severity: "info",
            title: "Marker AI",
            explanation: "The repository discloses AI usage.",
            fixPrompt: "Keep the disclosure up to date.",
          },
        ],
      }),
    );
    expect(info).toContain("READY");
    expect(info).toContain("0 risks to review");
    expect(info).toContain("1 informational signal");
    expect(info).not.toContain("Priority risks");
  });

  test("uses the configured policy threshold for status", () => {
    const passing = fakeResult({ trustScore: 88, findings: [] });
    expect(
      formatTerminalReport(passing, { minimumScore: 90 }),
    ).toContain("BLOCKED");
    expect(formatHtmlReport(passing, { minimumScore: 90 })).toContain(
      'status blocked',
    );

    const lowOnly = fakeResult({
      trustScore: 98,
      findings: [
        {
          id: "low:1",
          detectorId: "example",
          severity: "low",
          title: "Low finding",
          explanation: "A low-severity issue is present.",
          fixPrompt: "Review and fix the low-severity issue.",
        },
      ],
    });
    expect(
      formatTerminalReport(lowOnly, { failOn: ["low"] }),
    ).toContain("BLOCKED");
  });

  test("html is self-contained and includes badge snippet", () => {
    const html = formatHtmlReport(fakeResult());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Trust Score");
    expect(html).toContain("63");
    expect(textHas(html, "Why this is a risk")).toBe(true);
    expect(html).toContain("Recommended fix");
    expect(html).toContain("Next step");
    expect(html).toContain('data-filter="critical"');
    expect(html).toContain("prefers-color-scheme");
    expect(html).toContain("img.shields.io");
    expect(html).toContain("NovaCheck");
  });

  test("badge markdown and svg", () => {
    const r = fakeResult({ trustScore: 88 });
    const md = formatBadgeMarkdown(r);
    expect(md).toContain("shields.io");
    expect(md).toContain("88");
    const svg = formatBadgeSvg(r);
    expect(svg).toContain("<svg");
    expect(svg).toContain("88/100");
  });
});

describe("runScan orchestration", () => {
  test("assembles ScanResult from detectors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novacheck-scan-"));
    try {
      await Bun.write(join(dir, "package.json"), JSON.stringify({ name: "x", private: true }));
      const stub: Detector = {
        id: "stub",
        name: "Stub",
        description: "test",
        async run() {
          return [
            {
              id: "stub:1",
              detectorId: "stub",
              severity: "medium",
              title: "demo",
              explanation: "x".repeat(50),
              fixPrompt: "y".repeat(50),
            },
          ];
        },
      };
      const result = await runScan({ rootDir: dir, detectors: [stub] });
      expect(result.trustScore).toBe(95); // 100 - 5
      expect(result.findings).toHaveLength(1);
      expect(result.detectorsRun).toEqual(["stub"]);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("records skips from detectors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novacheck-skip-"));
    try {
      const stub: Detector = {
        id: "skipper",
        name: "Skipper",
        description: "test",
        async run(ctx) {
          ctx.skip("skipper", "niente da fare");
          return [];
        },
      };
      const result = await runScan({ rootDir: dir, detectors: [stub] });
      expect(result.detectorsSkipped).toEqual([
        { id: "skipper", reason: "niente da fare" },
      ]);
      expect(result.trustScore).toBe(100);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("records degraded detectors and incomplete inputs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novacheck-degraded-"));
    try {
      const stub: Detector = {
        id: "networked",
        name: "Networked",
        description: "test",
        async run(ctx) {
          ctx.reportIssue({
            detectorId: "networked",
            code: "lookup-failed",
            message: "A required lookup failed.",
          });
          return [];
        },
      };
      const result = await runScan({ rootDir: dir, detectors: [stub] });
      expect(result.diagnostics.incomplete).toBe(true);
      expect(result.diagnostics.issues).toHaveLength(1);
      expect(result.diagnostics.detectors[0]?.status).toBe("degraded");
      expect(formatTerminalReport(result)).toContain("INCOMPLETE");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function textHas(hay: string, needle: string): boolean {
  return hay.includes(needle);
}
