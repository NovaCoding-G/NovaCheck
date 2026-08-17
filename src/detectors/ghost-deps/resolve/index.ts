import type { Ecosystem, PackageSource } from "../types.ts";
import {
  isJsRuntimeBuiltin,
  isPythonBuiltin,
} from "./builtins.ts";
import { isLocalPathSpecifier } from "./local-path.ts";
import { loadPackageImports, matchesPackageImports } from "./package-imports.ts";
import { loadTsPathEntries, matchesTsPaths } from "./tsconfig-paths.ts";
import { detectUnevaluatedBundlerAliases } from "./blind-config.ts";
import {
  isWorkspacePackage,
  loadWorkspacePackageNames,
} from "./workspace.ts";
import type { ProjectResolveIndex, ResolutionResult, ResolverSkip } from "./types.ts";

export type {
  ProjectResolveIndex,
  ResolutionResult,
  ResolverId,
  ResolverSkip,
} from "./types.ts";
export { isLocalPathSpecifier } from "./local-path.ts";
export {
  isJsRuntimeBuiltin,
  isPythonBuiltin,
  NODE_BUILTINS,
  PY_STDLIB,
} from "./builtins.ts";
export { matchPathPattern } from "./pattern-match.ts";
export { stripJsonComments } from "./tsconfig-paths.ts";
export { parsePnpmWorkspacePackages } from "./workspace.ts";

/** Build a one-shot index of alias / workspace / blind configs for a project. */
export async function buildProjectResolveIndex(
  rootDir: string,
): Promise<ProjectResolveIndex> {
  const [ts, imports, workspaces, blind] = await Promise.all([
    loadTsPathEntries(rootDir),
    loadPackageImports(rootDir),
    loadWorkspacePackageNames(rootDir),
    detectUnevaluatedBundlerAliases(rootDir),
  ]);

  return {
    packageImports: imports.entries,
    tsPaths: ts.entries,
    workspacePackages: workspaces.names,
    hasUnevaluatedBundlerAlias: blind.hasUnevaluated,
    unevaluatedBundlerConfigs: blind.configs,
  };
}

export interface ResolveSpecifierInput {
  /** Raw import/require specifier, or bare package name from a manifest. */
  specifier: string;
  /** Bare package name derived for registry lookup (may equal specifier). */
  packageName: string;
  ecosystem: Ecosystem;
  source: PackageSource;
  index: ProjectResolveIndex;
}

/**
 * Phase 1 — resolve before any finding is emitted.
 * Excludes local / builtin / alias / workspace; marks blind when needed.
 */
export function resolveSpecifier(input: ResolveSpecifierInput): ResolutionResult {
  const { specifier, packageName, ecosystem, source, index } = input;
  const skipped: ResolverSkip[] = [];

  // --- local paths ---
  if (isLocalPathSpecifier(specifier)) {
    return {
      action: "exclude",
      resolversApplied: ["local-path"],
      resolversSkipped: skipped,
      reason: `Local path (${specifier}) — excluded`,
      packageName,
    };
  }

  // Conventional path-alias prefixes (even without a matching tsconfig entry)
  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    return {
      action: "exclude",
      resolversApplied: ["tsconfig-paths"],
      resolversSkipped: skipped,
      reason: `Path alias prefix (${specifier.startsWith("@/") ? "@/" : "~/"}) — excluded`,
      packageName,
    };
  }

  // --- runtime builtins ---
  if (ecosystem === "npm" && isJsRuntimeBuiltin(specifier)) {
    return {
      action: "exclude",
      resolversApplied: ["runtime-builtin"],
      resolversSkipped: skipped,
      reason: `Runtime builtin (${specifier}) — excluded`,
      packageName,
    };
  }
  if (ecosystem === "pypi" && isPythonBuiltin(packageName)) {
    return {
      action: "exclude",
      resolversApplied: ["runtime-builtin"],
      resolversSkipped: skipped,
      reason: `Python standard-library module (${packageName}) — excluded`,
      packageName,
    };
  }

  // --- package.json "imports" (#subpath) ---
  const importMatch = matchesPackageImports(specifier, index.packageImports);
  if (importMatch) {
    return {
      action: "exclude",
      resolversApplied: ["package-imports"],
      resolversSkipped: skipped,
      reason: `Matches package.json imports "${importMatch}" — excluded`,
      packageName,
    };
  }
  // Specifiers starting with # that did not match are still internal-by-convention
  if (specifier.startsWith("#")) {
    return {
      action: "exclude",
      resolversApplied: ["package-imports"],
      resolversSkipped: skipped,
      reason: `Unmapped subpath import (#), not a registry package — excluded`,
      packageName,
    };
  }

  // --- tsconfig / jsconfig paths ---
  const tsMatch = matchesTsPaths(specifier, index.tsPaths);
  if (tsMatch) {
    return {
      action: "exclude",
      resolversApplied: ["tsconfig-paths"],
      resolversSkipped: skipped,
      reason: `Matches tsconfig/jsconfig paths "${tsMatch}" — excluded`,
      packageName,
    };
  }

  // --- workspace / monorepo ---
  if (ecosystem === "npm" && isWorkspacePackage(packageName, index.workspacePackages)) {
    return {
      action: "exclude",
      resolversApplied: ["workspace"],
      resolversSkipped: skipped,
      reason: `Local workspace package (${packageName}) — excluded`,
      packageName,
    };
  }

  // Record skipped/unevaluated bundler alias configs (informational for findings)
  if (index.hasUnevaluatedBundlerAlias) {
    for (const cfg of index.unevaluatedBundlerConfigs) {
      skipped.push({
        resolver: "blind-bundler-alias",
        reason: `Alias detected in ${cfg} (not evaluated in this version)`,
      });
    }
  }

  // An install command names a registry package directly: bundler aliases and
  // path mappings cannot apply to something typed into a terminal.
  if (source === "docs") {
    return {
      action: "check-registry",
      resolversApplied: ["external-registry"],
      resolversSkipped: skipped,
      reason:
        "Install command in documentation or agent instructions — resolved against the registry",
      packageName,
    };
  }

  // Manifest declarations are never "alias-blind": the name is an explicit dep.
  if (source === "manifest") {
    return {
      action: "check-registry",
      resolversApplied: ["external-registry"],
      resolversSkipped: skipped,
      reason: "Declared in manifest — high-confidence registry candidate",
      packageName,
    };
  }

  // Import-only: if we know we have unevaluated bundler aliases, stay blind
  // so nonexistent → HIGH rather than CRITICAL.
  if (index.hasUnevaluatedBundlerAlias) {
    return {
      action: "blind",
      resolversApplied: ["blind-bundler-alias"],
      resolversSkipped: skipped,
      reason:
        "Possible unresolved alias — bundler configuration was detected but not evaluated",
      packageName,
    };
  }

  return {
    action: "check-registry",
    resolversApplied: ["external-registry"],
    resolversSkipped: skipped,
    reason:
      "Package-shaped specifier; no matching alias, workspace, or builtin",
    packageName,
  };
}
