import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyPolicy,
  loadPolicy,
  policyFailureReasons,
} from "../../src/config/policy.ts";
import { filterResultToChangedFiles } from "../../src/core/git-diff.ts";
import { formatSarifReport } from "../../src/reporters/sarif.ts";
import type { Finding, ScanResult } from "../../src/types/index.ts";

const findings: Finding[] = [
  {
    id: "dangerous-sinks:eval:src/app.ts:4",
    detectorId: "dangerous-sinks",
    severity: "critical",
    title: "Dynamic code execution",
    explanation: "Untrusted code can execute in the application process.",
    fixPrompt: "Remove eval and use a purpose-built parser.",
    file: "src/app.ts",
    line: 4,
    column: 3,
    metadata: { ruleId: "code-eval" },
  },
  {
    id: "secrets:test-fixture",
    detectorId: "secrets",
    severity: "high",
    title: "Fixture secret",
    explanation: "A test fixture contains a secret-like value.",
    fixPrompt: "Use a placeholder.",
    file: "tests/fixtures/leaky.ts",
    line: 1,
  },
];

function result(): ScanResult {
  return {
    trustScore: 63,
    findings: [...findings],
    detectorsRun: ["dangerous-sinks", "secrets"],
    detectorsSkipped: [],
    diagnostics: {
      detectors: [
        {
          detectorId: "dangerous-sinks",
          name: "Dangerous sinks",
          status: "ran",
          filesReceived: 2,
          filesAnalyzed: 2,
          discoveryPatterns: [],
          findingsCount: 1,
        },
        {
          detectorId: "secrets",
          name: "Secrets",
          status: "ran",
          filesReceived: 2,
          filesAnalyzed: 2,
          discoveryPatterns: [],
          findingsCount: 1,
        },
      ],
      totalFilesReceived: 4,
      uniqueFilesTouched: 2,
      discoveryPatterns: [],
    },
    scannedAt: "2026-08-05T12:00:00.000Z",
    rootDir: "/project",
    durationMs: 20,
  };
}

describe("SARIF reporter", () => {
  test("emits GitHub-compatible SARIF with locations and rules", () => {
    const sarif = JSON.parse(
      formatSarifReport(result(), {
        policyFailures: ["Trust Score 63 sotto la soglia 85"],
        minimumScore: 85,
        failOn: ["critical"],
        scope: { mode: "changed", base: "origin/main", filesCount: 2 },
      }),
    );
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results).toHaveLength(2);
    expect(sarif.runs[0].results[0].level).toBe("error");
    expect(
      sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation
        .uri,
    ).toBe("src/app.ts");
    expect(sarif.runs[0].tool.driver.rules.length).toBeGreaterThan(0);
    expect(sarif.runs[0].properties.policyPassed).toBe(false);
    expect(sarif.runs[0].properties.scope.mode).toBe("changed");
    expect(sarif.runs[0].invocations[0].properties.policyFailures).toHaveLength(
      1,
    );
  });
});

describe("policy", () => {
  test("loads YAML and ignores configured paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novacheck-policy-"));
    try {
      await writeFile(
        join(dir, ".novacheck.yml"),
        "minimumScore: 90\nfailOn: [critical]\nignore:\n  paths: [tests/fixtures/**]\n",
      );
      const loaded = await loadPolicy(dir);
      const filtered = applyPolicy(result(), loaded.policy);
      expect(loaded.path).toBe(join(dir, ".novacheck.yml"));
      expect(filtered.findings).toHaveLength(1);
      expect(filtered.findings[0]?.file).toBe("src/app.ts");
      expect(filtered.trustScore).toBe(75);
      expect(policyFailureReasons(filtered, loaded.policy, 70)).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects unknown configuration keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novacheck-policy-invalid-"));
    try {
      await writeFile(join(dir, ".novacheck.yml"), "magic: true\n");
      expect(loadPolicy(dir)).rejects.toThrow("chiavi sconosciute");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("changed-file scope", () => {
  test("recomputes findings and score from changed files only", () => {
    const filtered = filterResultToChangedFiles(
      result(),
      new Set(["src/app.ts"]),
    );
    expect(filtered.findings).toHaveLength(1);
    expect(filtered.trustScore).toBe(75);
    expect(
      filtered.diagnostics.detectors.find((d) => d.detectorId === "secrets")
        ?.findingsCount,
    ).toBe(0);
  });
});
