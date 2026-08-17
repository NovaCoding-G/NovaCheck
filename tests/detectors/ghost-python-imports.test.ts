import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectPackages,
  pypiDistributionForImport,
} from "../../src/detectors/ghost-deps/index.ts";

describe("pypiDistributionForImport", () => {
  test("maps well-known import/distribution mismatches", () => {
    expect(pypiDistributionForImport("yaml")).toBe("PyYAML");
    expect(pypiDistributionForImport("cv2")).toBe("opencv-python");
    expect(pypiDistributionForImport("sklearn")).toBe("scikit-learn");
    expect(pypiDistributionForImport("PIL")).toBe("Pillow");
    expect(pypiDistributionForImport("jwt")).toBe("PyJWT");
    expect(pypiDistributionForImport("dotenv")).toBe("python-dotenv");
  });

  test("keeps names that already match their distribution", () => {
    expect(pypiDistributionForImport("requests")).toBe("requests");
    expect(pypiDistributionForImport("fastapi")).toBe("fastapi");
  });

  test("skips namespace roots that no single distribution owns", () => {
    expect(pypiDistributionForImport("google")).toBeUndefined();
    expect(pypiDistributionForImport("azure")).toBeUndefined();
    expect(pypiDistributionForImport("zope")).toBeUndefined();
  });
});

describe("python imports are collected as distributions", () => {
  test("import yaml is verified as PyYAML, not as yaml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novacheck-py-import-"));
    try {
      await writeFile(
        join(dir, "worker.py"),
        [
          "import yaml",
          "import cv2",
          "from google.cloud import storage",
          "import hallucinated_ml_toolkit",
        ].join("\n"),
        "utf8",
      );

      const names = (await collectPackages(dir)).map((p) => p.name);
      expect(names).toContain("PyYAML");
      expect(names).toContain("opencv-python");
      expect(names).toContain("hallucinated_ml_toolkit");
      expect(names).not.toContain("yaml");
      expect(names).not.toContain("cv2");
      expect(names).not.toContain("google");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
