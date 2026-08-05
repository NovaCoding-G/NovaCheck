/**
 * Phase-1 resolution: decide whether a specifier is internal/builtin/local
 * (exclude) or an external package candidate (registry check).
 */

export type ResolverId =
  | "local-path"
  | "runtime-builtin"
  | "tsconfig-paths"
  | "package-imports"
  | "workspace"
  | "external-registry"
  | "blind-bundler-alias";

/** Why we did not run a resolver, or why we could not evaluate a config. */
export type ResolverSkip = {
  resolver: string;
  reason: string;
};

export type ResolutionAction = "exclude" | "check-registry" | "blind";

export interface ResolutionResult {
  action: ResolutionAction;
  /** Resolvers that contributed to this verdict (ordered). */
  resolversApplied: ResolverId[];
  /** Known resolvers/configs we saw but did not fully evaluate. */
  resolversSkipped: ResolverSkip[];
  /** Human-readable reason for the verdict. */
  reason: string;
  /** Bare package name for registry lookup (when action !== exclude). */
  packageName?: string;
}

export interface ProjectResolveIndex {
  /** package.json "imports" map keys → patterns we understand. */
  packageImports: ImportMapEntry[];
  /** tsconfig/jsconfig paths (including baseUrl-only matches). */
  tsPaths: TsPathEntry[];
  /** Workspace package names (npm) found in the monorepo. */
  workspacePackages: Set<string>;
  /**
   * True when we detected vite/webpack (or similar) resolve.alias that we
   * do not evaluate yet — import-only misses must be treated as blind.
   */
  hasUnevaluatedBundlerAlias: boolean;
  unevaluatedBundlerConfigs: string[];
}

export interface ImportMapEntry {
  /** Pattern as in package.json, e.g. "#lib/*" or "#utils". */
  pattern: string;
}

export interface TsPathEntry {
  /** Pattern key, e.g. "@/*" or "@app/*". */
  pattern: string;
  /** baseUrl relative to project root (posix). */
  baseUrl: string;
}
