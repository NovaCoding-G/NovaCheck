import type { ResolutionResult } from "./resolve/types.ts";

export type Ecosystem = "npm" | "pypi";

export interface DeclaredPackage {
  name: string;
  ecosystem: Ecosystem;
  /** Manifest or source file relative to project root. */
  file: string;
  line?: number;
  /** Where the name was discovered. */
  source: PackageSource;
  /**
   * Raw specifier as written (import/require), or the bare name for manifests.
   * Used by Phase-1 resolvers (aliases, #imports, paths).
   */
  specifier: string;
  /** Install command as written, for `docs` sources. */
  command?: string;
}

/**
 * `docs` covers install commands in prose (README, AGENTS.md, skill files):
 * a name a human or coding agent is instructed to install.
 */
export type PackageSource = "manifest" | "import" | "docs";

/** Package after Phase-1 resolution (excludes already filtered out). */
export interface ResolvedPackage extends DeclaredPackage {
  resolution: ResolutionResult;
}

export interface PackageInfo {
  name: string;
  ecosystem: Ecosystem;
  /** false = confirmed missing on registry; undefined = lookup skipped/unknown. */
  exists: boolean | undefined;
  createdAt?: Date;
  weeklyDownloads?: number;
  /** Present when the registry result is unknown because verification failed. */
  lookupIssue?: {
    code: string;
    message: string;
  };
}

export interface RegistryClient {
  lookup(ecosystem: Ecosystem, name: string): Promise<PackageInfo>;
}

export interface GhostDepsOptions {
  /** Flag packages younger than this many days. Default: 14. */
  maxAgeDays?: number;
  /** Flag packages with fewer weekly downloads than this. Default: 100. */
  minWeeklyDownloads?: number;
  /**
   * Only apply the low-download heuristic when the package is also younger
   * than this many days (avoids nagging old niche packages). Default: 180.
   */
  lowDownloadMaxAgeDays?: number;
}
