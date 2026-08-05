import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runScan } from "../../src/core/scan.ts";
import type { Finding, Severity } from "../../src/types/index.ts";

interface ExpectedFinding {
  detectorId: string;
  severity: Severity;
  /** Optional metadata.kind match (dangerous-sinks). */
  kind?: string;
}

interface ExpectedFile {
  description?: string;
  /** Score must be strictly below this (100 on known-bad = fail). */
  maxTrustScore: number;
  mustInclude: ExpectedFinding[];
}

const FIXTURES_ROOT = join(import.meta.dir, "../fixtures");

async function findExpectedJsonFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".novacheck") continue;
      out.push(...(await findExpectedJsonFiles(full)));
    } else if (e.name === "expected.json") {
      out.push(full);
    }
  }
  return out;
}

function matchesExpectation(f: Finding, exp: ExpectedFinding): boolean {
  if (f.detectorId !== exp.detectorId) return false;
  if (f.severity !== exp.severity) return false;
  if (exp.kind !== undefined && f.metadata?.kind !== exp.kind) return false;
  return true;
}

describe("golden known-bad fixtures", () => {
  test("js-app (dangerous-sinks) must not score 100 and must hit expected kinds", async () => {
    const fixtureDir = join(FIXTURES_ROOT, "dangerous-sinks/js-app");
    const expected = (await Bun.file(
      join(fixtureDir, "expected.json"),
    ).json()) as ExpectedFile;

    const result = await runScan({
      rootDir: fixtureDir,
      offline: true,
    });

    expect(result.trustScore).toBeLessThan(expected.maxTrustScore);
    expect(result.trustScore).not.toBe(100);

    const sink = result.diagnostics.detectors.find(
      (d) => d.detectorId === "dangerous-sinks",
    );
    expect(sink).toBeDefined();
    expect(sink!.status).toBe("ran");
    expect(sink!.filesAnalyzed).toBeGreaterThan(0);

    for (const exp of expected.mustInclude) {
      const hit = result.findings.some((f) => matchesExpectation(f, exp));
      expect(hit).toBe(true);
    }
  });

  test(
    "every expected.json under fixtures is enforced",
    async () => {
      const files = await findExpectedJsonFiles(FIXTURES_ROOT);
      expect(files.length).toBeGreaterThanOrEqual(1);

      for (const expectedPath of files) {
        const fixtureDir = join(expectedPath, "..");
        const expected = (await Bun.file(expectedPath).json()) as ExpectedFile;
        const result = await runScan({
          rootDir: fixtureDir,
          offline: true,
        });

        expect(result.trustScore).toBeLessThan(expected.maxTrustScore);

        for (const exp of expected.mustInclude) {
          const hit = result.findings.some((f) => matchesExpectation(f, exp));
          if (!hit) {
            throw new Error(
              `Fixture ${fixtureDir}: missing expected ${JSON.stringify(exp)}. ` +
                `Got: ${result.findings.map((f) => `${f.detectorId}/${f.severity}/${f.metadata?.kind ?? "-"}`).join(", ") || "(none)"}`,
            );
          }
        }
      }
    },
    20_000,
  );
});
