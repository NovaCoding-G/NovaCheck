import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createSecretsDetector,
  findEntropySecrets,
  lintContentWithSecretlint,
  maskSecret,
  runSecretsScan,
  shannonEntropy,
} from "../../src/detectors/secrets/index.ts";
import { createScanContext } from "../../src/core/create-context.ts";

const FIXTURES = join(import.meta.dir, "../fixtures/secrets");

describe("entropy helpers", () => {
  test("shannonEntropy is low for repeated chars", () => {
    expect(shannonEntropy("aaaaaaaaaaaaaaaaaaaaaaaa")).toBeLessThan(1);
  });

  test("shannonEntropy is high for random-looking strings", () => {
    expect(
      shannonEntropy("xK9mP2vQ7nR4sT8wY1zA3bC5dE6fG0hJ2kL4mN6pQ8rS"),
    ).toBeGreaterThan(4);
  });

  test("maskSecret hides the middle", () => {
    expect(maskSecret("abcdefghijklmnop")).toBe("abcd…mnop");
  });

  test("findEntropySecrets flags secret-named high-entropy values", () => {
    const hits = findEntropySecrets(
      `const api_key = "xK9mP2vQ7nR4sT8wY1zA3bC5dE6fG0hJ2kL4mN6pQ8rS";\n`,
    );
    expect(hits.length).toBe(1);
    expect(hits[0]?.name.toLowerCase()).toContain("api");
  });

  test("findEntropySecrets ignores placeholders", () => {
    const hits = findEntropySecrets(
      `const api_key = "your_api_key_here_please_replace";\n`,
    );
    expect(hits.length).toBe(0);
  });

  test("findEntropySecrets ignores non-secret names", () => {
    const hits = findEntropySecrets(
      `const sessionId = "xK9mP2vQ7nR4sT8wY1zA3bC5dE6fG0hJ2kL4mN6pQ8rS";\n`,
    );
    expect(hits.length).toBe(0);
  });
});

describe("secretlint engine", () => {
  test("detects GitHub PAT pattern", async () => {
    const hits = await lintContentWithSecretlint(
      `const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n`,
    );
    expect(hits.some((h) => h.ruleId.includes("github"))).toBe(true);
  });

  test("detects postgres connection string", async () => {
    const hits = await lintContentWithSecretlint(
      `url = "postgres://appuser:SuperSecretPassw0rd@db.example.com:5432/production"\n`,
    );
    expect(
      hits.some((h) => h.ruleId.includes("database-connection-string")),
    ).toBe(true);
  });

  test("masks secrets in messages", async () => {
    const hits = await lintContentWithSecretlint(
      `const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n`,
    );
    const msg = hits[0]?.message ?? "";
    expect(msg.includes("ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toBe(
      false,
    );
    expect(msg.includes("*") || msg.includes("…")).toBe(true);
  });
});

describe("runSecretsScan", () => {
  test("flags secrets in leaky fixture", async () => {
    const { findings } = await runSecretsScan(join(FIXTURES, "leaky-app"));
    expect(findings.length).toBeGreaterThanOrEqual(2);

    expect(
      findings.some((f) => f.metadata?.ruleId?.toString().includes("github")),
    ).toBe(true);
    expect(
      findings.some((f) =>
        f.metadata?.ruleId?.toString().includes("database-connection-string"),
      ),
    ).toBe(true);

    for (const f of findings) {
      expect(f.detectorId).toBe("secrets");
      expect(f.explanation.length).toBeGreaterThan(40);
      expect(f.fixPrompt.length).toBeGreaterThan(40);
      expect(f.file).toBeDefined();
      expect(f.line).toBeDefined();
      // Must not leak the raw github token into evidence
      expect(String(f.evidence)).not.toContain(
        "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      );
    }
  });

  test("stays quiet on clean fixture", async () => {
    const { findings } = await runSecretsScan(join(FIXTURES, "clean-app"));
    expect(findings).toHaveLength(0);
  });

  test("reports traversal failures instead of treating them as clean", async () => {
    const issues: string[] = [];
    const missing = join(FIXTURES, "does-not-exist");
    const result = await runSecretsScan(missing, {
      onIssue: (issue) => issues.push(issue.code),
    });
    expect(result.findings).toHaveLength(0);
    expect(issues).toEqual(["text-walk-directory-failed"]);
  });

  test("detector.run wires ScanContext", async () => {
    const detector = createSecretsDetector();
    const { ctx } = createScanContext({
      rootDir: join(FIXTURES, "leaky-app"),
    });
    const findings = await detector.run(ctx);
    expect(findings.some((f) => f.severity === "critical")).toBe(true);
  });
});
