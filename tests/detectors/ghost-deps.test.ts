import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  analyzePackage,
  buildProjectResolveIndex,
  collectPackages,
  collectPackagesDetailed,
  createGhostDepsDetector,
  levenshtein,
  matchPathPattern,
  normalizePackageName,
  packageNameFromSpecifier,
  parsePnpmWorkspacePackages,
  resolvePackages,
  resolveSpecifier,
  runGhostDepsAnalysis,
  type DeclaredPackage,
  type PackageInfo,
  type RegistryClient,
  type ResolvedPackage,
} from "../../src/detectors/ghost-deps/index.ts";
import { createScanContext } from "../../src/core/create-context.ts";

const FIXTURES = join(import.meta.dir, "../fixtures/ghost-deps");

function fakeRegistry(db: Record<string, PackageInfo>): RegistryClient {
  return {
    async lookup(ecosystem, name) {
      const key = `${ecosystem}:${normalizePackageName(name, ecosystem)}`;
      return (
        db[key] ?? {
          name,
          ecosystem,
          exists: false,
        }
      );
    },
  };
}

function resolved(
  pkg: Omit<DeclaredPackage, "specifier"> & { specifier?: string },
  action: ResolvedPackage["resolution"]["action"] = "check-registry",
): ResolvedPackage {
  const specifier = pkg.specifier ?? pkg.name;
  return {
    ...pkg,
    specifier,
    resolution: {
      action,
      resolversApplied:
        action === "blind"
          ? ["blind-bundler-alias"]
          : ["external-registry"],
      resolversSkipped:
        action === "blind"
          ? [
              {
                resolver: "blind-bundler-alias",
                reason: "Rilevato alias in vite.config.ts (non valutato)",
              },
            ]
          : [],
      reason:
        action === "blind"
          ? "Possibile alias non risolto — verifica"
          : "Candidato registry",
      packageName: pkg.name,
    },
  };
}

describe("heuristics", () => {
  test("levenshtein distance", () => {
    expect(levenshtein("lodash", "lodas")).toBe(1);
    expect(levenshtein("react", "react")).toBe(0);
    expect(levenshtein("requests", "requets")).toBe(1);
  });

  test("normalizePackageName pep503", () => {
    expect(normalizePackageName("Django_REST.Framework", "pypi")).toBe(
      "django-rest-framework",
    );
  });

  test("packageNameFromSpecifier", () => {
    expect(packageNameFromSpecifier("lodash")).toBe("lodash");
    expect(packageNameFromSpecifier("@scope/pkg/sub")).toBe("@scope/pkg");
    expect(packageNameFromSpecifier("./local")).toBeUndefined();
    expect(packageNameFromSpecifier("node:fs")).toBeUndefined();
    expect(packageNameFromSpecifier("fs")).toBeUndefined();
    expect(packageNameFromSpecifier("#lib/internal")).toBe("#lib");
  });

  test("matchPathPattern", () => {
    expect(matchPathPattern("@/*", "@/utils")).toBe(true);
    expect(matchPathPattern("@app/*", "@app/feature")).toBe(true);
    expect(matchPathPattern("#lib/*", "#lib/internal")).toBe(true);
    expect(matchPathPattern("@/*", "lodash")).toBe(false);
  });

  test("parsePnpmWorkspacePackages", () => {
    const yaml = `packages:\n  - 'packages/*'\n  - apps/**\n`;
    expect(parsePnpmWorkspacePackages(yaml)).toEqual([
      "packages/*",
      "apps/**",
    ]);
  });
});

describe("collectPackages", () => {
  test("reports traversal failures instead of treating them as complete", async () => {
    const issues: Array<{ code: string; file: string }> = [];
    const collected = await collectPackagesDetailed(
      join(FIXTURES, "does-not-exist"),
      (issue) => issues.push({ code: issue.code, file: issue.file }),
    );

    expect(collected.packages).toHaveLength(0);
    expect(issues).toEqual([
      { code: "ghost-deps-walk-directory-failed", file: "." },
    ]);
  });

  test("reads npm manifests and imports", async () => {
    const pkgs = await collectPackages(join(FIXTURES, "npm-project"));
    const names = pkgs.map((p) => p.name).sort();

    expect(names).toContain("react");
    expect(names).toContain("left-padx");
    expect(names).toContain("lodas");
    expect(names).toContain("brand-new-helper");
    expect(names).toContain("vite");
    expect(names).toContain("totally-fake-ai-pkg");

    const leftPadx = pkgs.find((p) => p.name === "left-padx");
    expect(leftPadx?.source).toBe("manifest");
    expect(leftPadx?.file).toBe("package.json");
    expect(leftPadx?.line).toBeDefined();
    expect(leftPadx?.specifier).toBe("left-padx");

    const react = pkgs.find((p) => p.name === "react");
    expect(react?.source).toBe("manifest");
  });

  test("reads python requirements and pyproject", async () => {
    const pkgs = await collectPackages(join(FIXTURES, "python-project"));
    const names = pkgs.map((p) => normalizePackageName(p.name, "pypi"));

    expect(names).toContain("requests");
    expect(names).toContain("django-restx");
    expect(names).toContain("fastapi");
    expect(names).toContain("hallucinated-ml-toolkit");
    expect(names).toContain("pytest");
    expect(names).not.toContain("os");
  });
});

describe("Phase 1 resolvers", () => {
  test("excludes tsconfig paths, package imports, and keeps external ghosts", async () => {
    const root = join(FIXTURES, "alias-project");
    const index = await buildProjectResolveIndex(root);
    expect(index.tsPaths.length).toBeGreaterThan(0);
    expect(index.packageImports.length).toBeGreaterThan(0);

    const collected = await collectPackages(root);
    const resolvedPkgs = resolvePackages(collected, index);
    const names = resolvedPkgs.map((p) => p.name);

    expect(names).not.toContain("@/utils");
    expect(names).not.toContain("@app/feature");
    expect(names).not.toContain("#lib");
    expect(names).toContain("totally-fake-ai-pkg");
    expect(names).toContain("react");

    const ghost = resolvedPkgs.find((p) => p.name === "totally-fake-ai-pkg");
    expect(ghost?.resolution.action).toBe("check-registry");
    expect(ghost?.resolution.resolversApplied).toContain("external-registry");
  });

  test("excludes workspace packages", async () => {
    const root = join(FIXTURES, "workspace-project");
    const index = await buildProjectResolveIndex(root);
    expect(index.workspacePackages.has("@acme/ui")).toBe(true);
    expect(index.workspacePackages.has("@acme/app")).toBe(true);

    const collected = await collectPackages(root);
    const resolvedPkgs = resolvePackages(collected, index);
    const names = resolvedPkgs.map((p) => p.name);

    expect(names).not.toContain("@acme/ui");
    expect(names).toContain("left-padx");
    expect(names).toContain("hallucinated-workspace-dep");
  });

  test("marks import-only as blind when vite alias is present", async () => {
    const root = join(FIXTURES, "blind-project");
    const index = await buildProjectResolveIndex(root);
    expect(index.hasUnevaluatedBundlerAlias).toBe(true);

    const resolution = resolveSpecifier({
      specifier: "maybe-alias-or-ghost",
      packageName: "maybe-alias-or-ghost",
      ecosystem: "npm",
      source: "import",
      index,
    });
    expect(resolution.action).toBe("blind");
    expect(resolution.reason).toContain("Possible unresolved alias");
  });

  test("manifest deps stay high-confidence even with vite alias", async () => {
    const root = join(FIXTURES, "blind-project");
    const index = await buildProjectResolveIndex(root);
    const resolution = resolveSpecifier({
      specifier: "left-padx",
      packageName: "left-padx",
      ecosystem: "npm",
      source: "manifest",
      index,
    });
    expect(resolution.action).toBe("check-registry");
  });
});

describe("analyzePackage (Phase 2 severity)", () => {
  const opts = {
    maxAgeDays: 14,
    minWeeklyDownloads: 100,
    lowDownloadMaxAgeDays: 180,
  };
  const now = new Date("2026-07-16T12:00:00.000Z");

  test("import-only nonexistent is CRITICAL when resolution is confident", () => {
    const findings = analyzePackage(
      resolved({
        name: "totally-fake-ai-pkg",
        ecosystem: "npm",
        file: "src/app.ts",
        line: 2,
        source: "import",
      }),
      { name: "totally-fake-ai-pkg", ecosystem: "npm", exists: false },
      opts,
      now,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.metadata?.resolversApplied).toContain("external-registry");
    expect(findings[0]?.explanation).toContain("Resolvers applied");
  });

  test("manifest nonexistent is CRITICAL (same as import-only)", () => {
    const findings = analyzePackage(
      resolved({
        name: "left-padx",
        ecosystem: "npm",
        file: "package.json",
        line: 6,
        source: "manifest",
      }),
      { name: "left-padx", ecosystem: "npm", exists: false },
      opts,
      now,
    );
    expect(findings[0]?.severity).toBe("critical");
  });

  test("blind nonexistent is HIGH with alias note", () => {
    const findings = analyzePackage(
      resolved(
        {
          name: "maybe-alias-or-ghost",
          ecosystem: "npm",
          file: "src/app.ts",
          line: 1,
          source: "import",
        },
        "blind",
      ),
      { name: "maybe-alias-or-ghost", ecosystem: "npm", exists: false },
      opts,
      now,
    );
    expect(findings[0]?.severity).toBe("high");
    expect(findings[0]?.explanation).toContain("unresolved alias");
    expect(findings[0]?.id).toContain("nonexistent-blind");
  });

  test("typosquat is CRITICAL regardless of source", () => {
    const findings = analyzePackage(
      resolved({
        name: "lodas",
        ecosystem: "npm",
        file: "package.json",
        line: 7,
        source: "manifest",
      }),
      {
        name: "lodas",
        ecosystem: "npm",
        exists: true,
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
        weeklyDownloads: 20,
      },
      opts,
      now,
    );
    const typo = findings.find((f) => f.id.includes("typosquat"));
    expect(typo?.severity).toBe("critical");
    expect(typo?.metadata?.typosquatOf).toBe("lodash");
    expect(findings).toHaveLength(1);
  });

  test("stays silent when lookup is unknown and not blind", () => {
    const findings = analyzePackage(
      resolved({
        name: "left-padx",
        ecosystem: "npm",
        file: "package.json",
        line: 6,
        source: "manifest",
      }),
      { name: "left-padx", ecosystem: "npm", exists: undefined },
      opts,
      now,
    );
    expect(findings).toHaveLength(0);
  });

  test("flags very new packages", () => {
    const findings = analyzePackage(
      resolved({
        name: "brand-new-helper",
        ecosystem: "npm",
        file: "package.json",
        line: 8,
        source: "manifest",
      }),
      {
        name: "brand-new-helper",
        ecosystem: "npm",
        exists: true,
        createdAt: new Date("2026-07-10T00:00:00.000Z"),
        weeklyDownloads: 5000,
      },
      opts,
      now,
    );
    const recent = findings.find((f) => f.id.includes("very-new"));
    expect(recent?.severity).toBe("medium");
  });

  test("does not flag the real popular package as typosquat", () => {
    const findings = analyzePackage(
      resolved({
        name: "lodash",
        ecosystem: "npm",
        file: "package.json",
        line: 1,
        source: "manifest",
      }),
      {
        name: "lodash",
        ecosystem: "npm",
        exists: true,
        createdAt: new Date("2012-01-01T00:00:00.000Z"),
        weeklyDownloads: 50_000_000,
      },
      opts,
      now,
    );
    expect(findings).toHaveLength(0);
  });
});

describe("runGhostDepsAnalysis (integration)", () => {
  test("attaches unknown registry diagnostics to source files", async () => {
    const issues: Array<{ code: string; file: string }> = [];
    await runGhostDepsAnalysis(
      join(FIXTURES, "npm-project"),
      {
        async lookup(ecosystem, name) {
          return { name, ecosystem, exists: undefined };
        },
      },
      {},
      new Date("2026-07-16T12:00:00.000Z"),
      (issue) => issues.push(issue),
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.file.length > 0)).toBe(true);
    expect(issues.some((issue) => issue.file === "package.json")).toBe(true);
  });

  test("npm fixture: import-only ghost is CRITICAL", async () => {
    const registry = fakeRegistry({
      "npm:react": {
        name: "react",
        ecosystem: "npm",
        exists: true,
        createdAt: new Date("2013-01-01"),
        weeklyDownloads: 20_000_000,
      },
      "npm:vite": {
        name: "vite",
        ecosystem: "npm",
        exists: true,
        createdAt: new Date("2020-01-01"),
        weeklyDownloads: 5_000_000,
      },
      "npm:left-padx": {
        name: "left-padx",
        ecosystem: "npm",
        exists: false,
      },
      "npm:lodas": {
        name: "lodas",
        ecosystem: "npm",
        exists: true,
        createdAt: new Date("2026-06-01"),
        weeklyDownloads: 8,
      },
      "npm:brand-new-helper": {
        name: "brand-new-helper",
        ecosystem: "npm",
        exists: true,
        createdAt: new Date("2026-07-12"),
        weeklyDownloads: 3,
      },
      "npm:totally-fake-ai-pkg": {
        name: "totally-fake-ai-pkg",
        ecosystem: "npm",
        exists: false,
      },
    });

    const { findings } = await runGhostDepsAnalysis(
      join(FIXTURES, "npm-project"),
      registry,
      {},
      new Date("2026-07-16T12:00:00.000Z"),
    );

    const importGhost = findings.find((f) =>
      f.id.includes("totally-fake-ai-pkg"),
    );
    expect(importGhost?.severity).toBe("critical");
    expect(importGhost?.metadata?.source).toBe("import");

    const manifestGhost = findings.find((f) => f.id.includes("left-padx"));
    expect(manifestGhost?.severity).toBe("critical");

    for (const f of findings) {
      expect(f.fixPrompt.length).toBeGreaterThan(20);
      expect(f.explanation).toContain("Resolver");
      expect(f.metadata?.resolversApplied).toBeDefined();
    }
  });

  test("alias fixture does not flag path/alias imports", async () => {
    const registry = fakeRegistry({
      "npm:react": {
        name: "react",
        ecosystem: "npm",
        exists: true,
        createdAt: new Date("2013-01-01"),
        weeklyDownloads: 20_000_000,
      },
      "npm:totally-fake-ai-pkg": {
        name: "totally-fake-ai-pkg",
        ecosystem: "npm",
        exists: false,
      },
    });

    const { findings } = await runGhostDepsAnalysis(
      join(FIXTURES, "alias-project"),
      registry,
    );

    expect(findings.every((f) => !String(f.evidence).includes("@/"))).toBe(true);
    expect(findings.every((f) => !String(f.evidence).startsWith("#"))).toBe(true);
    expect(
      findings.some(
        (f) =>
          f.evidence === "totally-fake-ai-pkg" && f.severity === "critical",
      ),
    ).toBe(true);
  });

  test("blind fixture: import-only nonexistent is HIGH", async () => {
    const registry = fakeRegistry({});
    const { findings } = await runGhostDepsAnalysis(
      join(FIXTURES, "blind-project"),
      registry,
    );
    const f = findings.find((x) => x.evidence === "maybe-alias-or-ghost");
    expect(f?.severity).toBe("high");
    expect(f?.explanation).toContain("unresolved alias");
  });

  test("workspace fixture excludes @acme/ui, flags real ghosts", async () => {
    const registry = fakeRegistry({
      "npm:left-padx": { name: "left-padx", ecosystem: "npm", exists: false },
      "npm:hallucinated-workspace-dep": {
        name: "hallucinated-workspace-dep",
        ecosystem: "npm",
        exists: false,
      },
    });

    const { findings } = await runGhostDepsAnalysis(
      join(FIXTURES, "workspace-project"),
      registry,
    );

    expect(findings.every((f) => f.evidence !== "@acme/ui")).toBe(true);
    expect(
      findings.some(
        (f) => f.evidence === "hallucinated-workspace-dep" && f.severity === "critical",
      ),
    ).toBe(true);
    expect(
      findings.some((f) => f.evidence === "left-padx" && f.severity === "critical"),
    ).toBe(true);
  });

  test("detector.run wires through ScanContext", async () => {
    const registry = fakeRegistry({
      "pypi:requests": {
        name: "requests",
        ecosystem: "pypi",
        exists: true,
        createdAt: new Date("2011-01-01"),
      },
      "pypi:fastapi": {
        name: "fastapi",
        ecosystem: "pypi",
        exists: true,
        createdAt: new Date("2018-01-01"),
      },
      "pypi:pytest": {
        name: "pytest",
        ecosystem: "pypi",
        exists: true,
        createdAt: new Date("2010-01-01"),
      },
      "pypi:django-restx": {
        name: "django-restx",
        ecosystem: "pypi",
        exists: false,
      },
      "pypi:hallucinated-ml-toolkit": {
        name: "hallucinated-ml-toolkit",
        ecosystem: "pypi",
        exists: false,
      },
    });

    const detector = createGhostDepsDetector({ registry });
    const { ctx } = createScanContext({
      rootDir: join(FIXTURES, "python-project"),
      offline: true,
    });

    const findings = await detector.run(ctx);
    expect(findings.some((f) => f.severity === "critical")).toBe(true);
    expect(
      findings.some((f) => f.evidence === "hallucinated-ml-toolkit"),
    ).toBe(true);
  });
});
