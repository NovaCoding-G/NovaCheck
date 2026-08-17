import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  collectPackages,
  extractInstallPackages,
  isAgentDocFile,
  normalizePackageName,
  npmNameFromToken,
  pypiNameFromToken,
  registryNameForManifestEntry,
  runGhostDepsAnalysis,
  type PackageInfo,
  type RegistryClient,
} from "../../src/detectors/ghost-deps/index.ts";

const FIXTURES = join(import.meta.dir, "../fixtures/ghost-deps");

function fakeRegistry(db: Record<string, PackageInfo>): RegistryClient {
  return {
    async lookup(ecosystem, name) {
      const key = `${ecosystem}:${normalizePackageName(name, ecosystem)}`;
      return db[key] ?? { name, ecosystem, exists: false };
    },
  };
}

const REAL_PACKAGES: Record<string, PackageInfo> = {
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
  "pypi:requests": {
    name: "requests",
    ecosystem: "pypi",
    exists: true,
    createdAt: new Date("2011-01-01"),
    weeklyDownloads: 9_000_000,
  },
};

describe("install-command token parsing", () => {
  test("strips versions and keeps scoped names", () => {
    expect(npmNameFromToken("lodash")).toBe("lodash");
    expect(npmNameFromToken("lodash@4.17.21")).toBe("lodash");
    expect(npmNameFromToken("@scope/pkg@next")).toBe("@scope/pkg");
    expect(npmNameFromToken("create-next-app@latest")).toBe("create-next-app");
  });

  test("rejects flags, paths, archives and placeholders", () => {
    expect(npmNameFromToken("--save-dev")).toBeUndefined();
    expect(npmNameFromToken("./local")).toBeUndefined();
    expect(npmNameFromToken("/abs/path")).toBeUndefined();
    expect(npmNameFromToken("https://example.com/x.tgz")).toBeUndefined();
    expect(npmNameFromToken("git+https://example.com/x.git")).toBeUndefined();
    expect(npmNameFromToken("package-name")).toBeUndefined();
    expect(npmNameFromToken("<your-package>")).toBeUndefined();
    expect(npmNameFromToken("your-package")).toBeUndefined();
    expect(npmNameFromToken("^1.2.3")).toBeUndefined();
    expect(npmNameFromToken("packages/ui")).toBeUndefined();
  });

  test("normalizes python specifiers", () => {
    expect(pypiNameFromToken("requests")).toBe("requests");
    expect(pypiNameFromToken("requests==2.31.0")).toBe("requests");
    expect(pypiNameFromToken("fastapi[all]")).toBe("fastapi");
    expect(pypiNameFromToken("django>=5")).toBe("django");
    expect(pypiNameFromToken("requirements.txt")).toBeUndefined();
  });
});

describe("registryNameForManifestEntry", () => {
  test("keeps ordinary semver dependencies", () => {
    expect(registryNameForManifestEntry("react", "^19.0.0")).toBe("react");
    expect(registryNameForManifestEntry("react", "*")).toBe("react");
    expect(registryNameForManifestEntry("@scope/pkg", "latest")).toBe(
      "@scope/pkg",
    );
  });

  test("ignores specifiers that are not registry packages", () => {
    expect(
      registryNameForManifestEntry("legacy-lib", "git+http://x.example/l.git"),
    ).toBeUndefined();
    expect(registryNameForManifestEntry("ui", "workspace:*")).toBeUndefined();
    expect(registryNameForManifestEntry("ui", "file:../ui")).toBeUndefined();
    expect(registryNameForManifestEntry("ui", "link:../ui")).toBeUndefined();
    expect(registryNameForManifestEntry("cli", "github:acme/cli")).toBeUndefined();
    expect(
      registryNameForManifestEntry("tar", "https://x.example/tar.tgz"),
    ).toBeUndefined();
  });

  test("follows npm: aliases to the package actually installed", () => {
    expect(registryNameForManifestEntry("lodash-es", "npm:lodash@4.17.21")).toBe(
      "lodash",
    );
    expect(registryNameForManifestEntry("ui", "npm:@scope/ui@^2")).toBe(
      "@scope/ui",
    );
  });
});

describe("extractInstallPackages", () => {
  test("reads every package a documented command would install", () => {
    const refs = extractInstallPackages(
      [
        "```bash",
        "npm install react hallucinated-agent-helper",
        "$ pnpm add -D @scope/tool@1.0.0",
        "pip install requests ghost-py-toolkit",
        "uv pip install another-ghost-lib",
        "poetry add ghost-poetry-lib",
        "```",
      ].join("\n"),
    );
    const names = refs.map((r) => r.name);

    expect(names).toContain("react");
    expect(names).toContain("hallucinated-agent-helper");
    expect(names).toContain("@scope/tool");
    expect(names).toContain("requests");
    expect(names).toContain("ghost-py-toolkit");
    expect(names).toContain("another-ghost-lib");
    expect(names).toContain("ghost-poetry-lib");

    const ghost = refs.find((r) => r.name === "hallucinated-agent-helper");
    expect(ghost?.ecosystem).toBe("npm");
    expect(ghost?.line).toBe(2);
    expect(ghost?.command).toContain("npm install react");

    expect(refs.find((r) => r.name === "ghost-py-toolkit")?.ecosystem).toBe(
      "pypi",
    );
  });

  test("takes only the first positional argument of a runner", () => {
    const refs = extractInstallPackages(
      "npx -y phantom-codemod --transform ./src other-arg",
    );
    expect(refs.map((r) => r.name)).toEqual(["phantom-codemod"]);
  });

  test("splits chained commands", () => {
    const refs = extractInstallPackages(
      "npm i vite && bunx skill-ghost-cli init; pip install ghost-py-toolkit",
    );
    expect(refs.map((r) => r.name).sort()).toEqual([
      "ghost-py-toolkit",
      "skill-ghost-cli",
      "vite",
    ]);
  });

  test("ignores non-install commands, placeholders and requirement files", () => {
    const refs = extractInstallPackages(
      [
        "npm run build",
        "npm ci",
        "bun install",
        "npm install <your-package>",
        "npm install package-name",
        "pip install -r requirements.txt",
        "npx ./scripts/local.js",
        "npm exec --yes --package=novacheck -- novacheck",
      ].join("\n"),
    );
    expect(refs).toHaveLength(0);
  });

  test("recognizes documentation and agent instruction files", () => {
    expect(isAgentDocFile("AGENTS.md")).toBe(true);
    expect(isAgentDocFile("SKILL.md")).toBe(true);
    expect(isAgentDocFile("guide.mdx")).toBe(true);
    expect(isAgentDocFile("rules.mdc")).toBe(true);
    expect(isAgentDocFile("compose.yaml")).toBe(true);
    expect(isAgentDocFile(".windsurfrules")).toBe(true);
    expect(isAgentDocFile("app.ts")).toBe(false);
    expect(isAgentDocFile("package.json")).toBe(false);
  });
});

describe("ghost-deps over documentation", () => {
  test("collects documented installs with source docs", async () => {
    const pkgs = await collectPackages(join(FIXTURES, "agent-docs-project"));
    const byName = new Map(pkgs.map((p) => [p.name, p]));

    const ghost = byName.get("hallucinated-agent-helper");
    expect(ghost?.source).toBe("docs");
    expect(ghost?.file).toBe("AGENTS.md");
    expect(ghost?.line).toBe(6);
    expect(ghost?.command).toContain("npm install");

    expect(byName.get("phantom-codemod")?.source).toBe("docs");
    expect(byName.get("skill-ghost-cli")?.file).toBe("SKILL.md");
    expect(byName.get("ghost-py-toolkit")?.ecosystem).toBe("pypi");
    expect(byName.get("another-ghost-lib")?.ecosystem).toBe("pypi");

    // A manifest declaration outranks the same name documented in prose.
    expect(byName.get("react")?.source).toBe("manifest");

    expect(byName.has("package-name")).toBe(false);
    expect(byName.has("your-package")).toBe(false);
  });

  test("a documented install of a nonexistent package is CRITICAL", async () => {
    const { findings } = await runGhostDepsAnalysis(
      join(FIXTURES, "agent-docs-project"),
      fakeRegistry(REAL_PACKAGES),
    );

    const ghost = findings.find(
      (f) => f.metadata?.package === "hallucinated-agent-helper",
    );
    expect(ghost?.severity).toBe("critical");
    expect(ghost?.metadata?.source).toBe("docs");
    expect(ghost?.metadata?.command).toContain("npm install");
    expect(ghost?.file).toBe("AGENTS.md");
    expect(ghost?.explanation).toContain("install command");
    expect(ghost?.explanation).toContain("coding agent");
    expect(ghost?.fixPrompt).toContain("AGENTS.md");

    const runner = findings.find(
      (f) => f.metadata?.package === "phantom-codemod",
    );
    expect(runner?.severity).toBe("critical");

    const python = findings.find(
      (f) => f.metadata?.package === "ghost-py-toolkit",
    );
    expect(python?.severity).toBe("critical");
    expect(python?.metadata?.ecosystem).toBe("pypi");

    // Real packages named in the same files stay silent.
    expect(findings.some((f) => f.metadata?.package === "react")).toBe(false);
    expect(findings.some((f) => f.metadata?.package === "requests")).toBe(false);
    expect(findings.some((f) => f.metadata?.package === "vite")).toBe(false);
  });
});
