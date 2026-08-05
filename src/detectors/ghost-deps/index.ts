import type { Detector, Finding, ScanContext } from "../../types/index.ts";
import { runGhostDepsAnalysis } from "./analyze.ts";
import { HttpRegistryClient } from "./registry/http-client.ts";
import { RegistryCache } from "./registry/cache.ts";
import type { GhostDepsOptions, RegistryClient } from "./types.ts";

export type {
  GhostDepsOptions,
  RegistryClient,
  PackageInfo,
  DeclaredPackage,
  ResolvedPackage,
} from "./types.ts";
export {
  collectPackages,
  collectPackagesDetailed,
  packageNameFromSpecifier,
} from "./collect.ts";
export {
  analyzePackage,
  resolvePackages,
  runGhostDepsAnalysis,
} from "./analyze.ts";
export { levenshtein, normalizePackageName } from "./heuristics.ts";
export { HttpRegistryClient } from "./registry/http-client.ts";
export { RegistryCache } from "./registry/cache.ts";
export {
  buildProjectResolveIndex,
  resolveSpecifier,
  isLocalPathSpecifier,
  isJsRuntimeBuiltin,
  matchPathPattern,
  parsePnpmWorkspacePackages,
  stripJsonComments,
} from "./resolve/index.ts";
export type { ResolutionResult, ProjectResolveIndex } from "./resolve/index.ts";

export interface GhostDepsDetectorOptions extends GhostDepsOptions {
  /** Inject a fake registry in tests. */
  registry?: RegistryClient;
}

export function createGhostDepsDetector(
  options: GhostDepsDetectorOptions = {},
): Detector {
  return {
    id: "ghost-deps",
    name: "Dipendenze fantasma / slopsquatting",
    description:
      "Verifica che i pacchetti dichiarati o importati esistano sui registry e non siano sospetti (nuovi, poco scaricati, typosquat).",
    async run(ctx: ScanContext): Promise<Finding[]> {
      const registry =
        options.registry ??
        new HttpRegistryClient({
          cache: new RegistryCache(ctx.cacheDir),
          offline: ctx.offline,
          signal: ctx.signal,
        });

      const result = await runGhostDepsAnalysis(
        ctx.rootDir,
        registry,
        options,
      );
      ctx.recordStats({
        detectorId: "ghost-deps",
        name: "Dipendenze fantasma / slopsquatting",
        filesReceived: result.filesReceived,
        filesAnalyzed: result.filesAnalyzed,
        discoveryPatterns: result.discoveryPatterns,
        files: result.files,
        findingsCount: result.findings.length,
      });
      return result.findings;
    },
  };
}

/** Default singleton used by the scanner orchestrator. */
export const ghostDepsDetector = createGhostDepsDetector();
