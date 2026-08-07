import type { Finding } from "../../types/index.ts";
import {
  collectPackagesDetailed,
  ecosystemLabel,
  GHOST_DEPS_DISCOVERY_PATTERNS,
} from "./collect.ts";
import {
  daysSince,
  levenshtein,
  normalizePackageName,
  similarDistanceThreshold,
} from "./heuristics.ts";
import { popularFor } from "./popular-names.ts";
import {
  buildProjectResolveIndex,
  resolveSpecifier,
  type ProjectResolveIndex,
  type ResolutionResult,
} from "./resolve/index.ts";
import type {
  DeclaredPackage,
  GhostDepsOptions,
  PackageInfo,
  RegistryClient,
  ResolvedPackage,
} from "./types.ts";

const DEFAULTS = {
  maxAgeDays: 14,
  minWeeklyDownloads: 100,
  lowDownloadMaxAgeDays: 180,
} as const;

const REGISTRY_LOOKUP_CONCURRENCY = 8;

function findTyposquatTarget(
  name: string,
  ecosystem: DeclaredPackage["ecosystem"],
): string | undefined {
  const normalized = normalizePackageName(name, ecosystem);
  const popular = popularFor(ecosystem);
  const threshold = similarDistanceThreshold(normalized);

  let best: { name: string; dist: number } | undefined;
  for (const candidate of popular) {
    const cNorm = normalizePackageName(candidate, ecosystem);
    if (cNorm === normalized) return undefined;
    const dist = levenshtein(normalized, cNorm);
    if (dist > 0 && dist <= threshold) {
      if (!best || dist < best.dist) best = { name: candidate, dist };
    }
  }
  return best?.name;
}

function formatResolvers(resolution: ResolutionResult): string {
  const applied =
    resolution.resolversApplied.length > 0
      ? resolution.resolversApplied.join(", ")
      : "none";
  const skipped =
    resolution.resolversSkipped.length > 0
      ? resolution.resolversSkipped
          .map((s) => `${s.resolver} (${s.reason})`)
          .join("; ")
      : "none";
  return `Resolvers applied: ${applied}. Resolvers skipped: ${skipped}.`;
}

function findingBase(
  pkg: ResolvedPackage,
  kind: string,
  severity: Finding["severity"],
  title: string,
  explanation: string,
  fixPrompt: string,
  evidence?: string,
  metadata?: Record<string, unknown>,
): Finding {
  const norm = normalizePackageName(pkg.name, pkg.ecosystem);
  const resolutionNote = formatResolvers(pkg.resolution);
  return {
    id: `ghost-deps:${kind}:${pkg.ecosystem}:${norm}`,
    detectorId: "ghost-deps",
    severity,
    title,
    explanation: `${explanation} ${resolutionNote}`,
    fixPrompt,
    file: pkg.file,
    line: pkg.line,
    evidence: evidence ?? pkg.name,
    metadata: {
      package: pkg.name,
      ecosystem: pkg.ecosystem,
      source: pkg.source,
      specifier: pkg.specifier,
      resolversApplied: pkg.resolution.resolversApplied,
      resolversSkipped: pkg.resolution.resolversSkipped,
      resolutionAction: pkg.resolution.action,
      resolutionReason: pkg.resolution.reason,
      ...metadata,
    },
  };
}

/**
 * Phase 2 — severity from resolution confidence, not from manifest vs import.
 *
 * - CRITICAL: package-shaped, resolved as external, nonexistent on registry
 * - CRITICAL: typosquat distance to a popular package (anywhere)
 * - HIGH: resolver is blind (unevaluated bundler alias / ambiguous)
 *
 * TODO(ghost-deps): when we evaluate vite/webpack `resolve.alias`, promote
 * blind import-only nonexistent findings from HIGH → CRITICAL (same as
 * high-confidence external). Until then, blind stays HIGH with an explicit note.
 */
export function analyzePackage(
  pkg: ResolvedPackage,
  info: PackageInfo,
  options: Required<GhostDepsOptions>,
  now = new Date(),
): Finding[] {
  const findings: Finding[] = [];
  const registry = ecosystemLabel(pkg.ecosystem);
  const typosquatOf = findTyposquatTarget(pkg.name, pkg.ecosystem);
  const blind = pkg.resolution.action === "blind";

  // Unknown lookup: stay silent unless we are blind (then warn at HIGH).
  if (info.exists === undefined) {
    if (blind) {
      findings.push(
        findingBase(
          pkg,
          "ambiguous-blind",
          "high",
          `Ambiguous specifier (unresolved alias): ${pkg.name}`,
          `NovaCheck could not verify \`${pkg.name}\` on the registry, and the resolver cannot inspect ` +
            `all alias/bundler configuration. It may be an unresolved alias; verify it before treating it as an external dependency.`,
          `Check whether "${pkg.name}" in ${pkg.file}` +
            (pkg.line ? `:${pkg.line}` : "") +
            ` is a local alias (tsconfig paths, Vite/Webpack resolve.alias, workspace) or an external package. ` +
            `If it is an alias, do not add it to the manifest; if external, confirm the exact registry name.`,
          pkg.name,
          { blind: true },
        ),
      );
    }
    return findings;
  }

  if (info.exists === false) {
    const whyTypo = typosquatOf
      ? ` The name is also very similar to the popular package \`${typosquatOf}\`, a typical slopsquatting or typosquatting pattern.`
      : "";

    // Blind → HIGH (possible unresolved alias). High-confidence external → CRITICAL.
    // Typosquat of a popular name is always CRITICAL even under blind resolution.
    const severity: Finding["severity"] =
      typosquatOf || !blind ? "critical" : "high";

    const blindNote = blind
      ? " This may be an unresolved alias; the resolver could not rule out alias/bundler configuration."
      : "";

    const kind = typosquatOf
      ? "nonexistent-typosquat"
      : blind
        ? "nonexistent-blind"
        : "nonexistent";

    findings.push(
      findingBase(
        pkg,
        kind,
        severity,
        `Package does not exist on ${registry}: ${pkg.name}`,
        `The package \`${pkg.name}\` is declared or imported but does not exist on ${registry}. ` +
          `In AI-generated projects this often indicates a hallucinated dependency (slopsquatting): ` +
          `an invented name that an attacker could register and fill with malware.${whyTypo}${blindNote}`,
        `The package "${pkg.name}" (${registry}) does not exist on the registry. ` +
          `Find every reference in ${pkg.file}` +
          (pkg.line ? ` (line ${pkg.line})` : "") +
          ` and in manifests. ` +
          (blind
            ? `First verify whether it is a local alias (tsconfig paths, Vite/Webpack resolve.alias, workspace). `
            : "") +
          `Replace it with the correct maintained package` +
          (typosquatOf ? ` (possibly "${typosquatOf}")` : "") +
          `, update dependencies, and verify that build and tests pass. Do not ship until the ghost package is removed.`,
        pkg.name,
        { typosquatOf, blind },
      ),
    );
    return findings;
  }

  // Exists — age / downloads / typosquat
  const ageDays =
    info.createdAt !== undefined ? daysSince(info.createdAt, now) : undefined;
  const weakTyposquat = Boolean(
    typosquatOf &&
      ((ageDays !== undefined && ageDays < options.lowDownloadMaxAgeDays) ||
        (info.weeklyDownloads !== undefined &&
          info.weeklyDownloads < options.minWeeklyDownloads)),
  );

  if (
    !weakTyposquat &&
    ageDays !== undefined &&
    ageDays < options.maxAgeDays
  ) {
    findings.push(
      findingBase(
        pkg,
        "very-new",
        "medium",
        `Very recent package on ${registry}: ${pkg.name}`,
        `"${pkg.name}" has existed on ${registry} for only about ${Math.max(0, Math.floor(ageDays))} days. ` +
          `Very new packages are a common follow-up to AI hallucinations: ` +
          `someone registers an invented name and publishes malicious code. Verify maintainers, repository, and downloads before trusting it.`,
        `The package "${pkg.name}" on ${registry} was published less than ${options.maxAgeDays} days ago. ` +
          `Confirm this is intentional by checking the registry page, repository, and maintainers. ` +
          `If uncertain, replace it with a mature alternative and update ${pkg.file}.`,
        pkg.name,
        { ageDays: Math.floor(ageDays), createdAt: info.createdAt?.toISOString() },
      ),
    );
  }

  if (
    !weakTyposquat &&
    pkg.ecosystem === "npm" &&
    info.weeklyDownloads !== undefined &&
    info.weeklyDownloads < options.minWeeklyDownloads &&
    ageDays !== undefined &&
    ageDays < options.lowDownloadMaxAgeDays
  ) {
    findings.push(
      findingBase(
        pkg,
        "low-downloads",
        "low",
        `Low weekly downloads: ${pkg.name}`,
        `"${pkg.name}" had about ${info.weeklyDownloads} npm downloads in the last week and is not a mature package. ` +
          `When combined with AI-generated code, recent low-usage packages deserve manual review of their maintainers and contents.`,
        `The npm package "${pkg.name}" has fewer than ${options.minWeeklyDownloads} weekly downloads and is less than ${options.lowDownloadMaxAgeDays} days old. ` +
          `Confirm it is the intended package and not a typosquat; otherwise replace it with the correct popular alternative and update ${pkg.file}.`,
        pkg.name,
        { weeklyDownloads: info.weeklyDownloads, ageDays: Math.floor(ageDays) },
      ),
    );
  }

  // Typosquat of popular name → CRITICAL always (manifest or import).
  // Still require weak trust signals when the package exists, to limit FPs
  // on legitimate near-names (e.g. vuex vs vue).
  if (typosquatOf) {
    if (weakTyposquat) {
      findings.push(
        findingBase(
          pkg,
          "typosquat",
          "critical",
          `Suspicious name (similar to ${typosquatOf}): ${pkg.name}`,
          `"${pkg.name}" is very similar to the popular package \`${typosquatOf}\` and has weak trust signals ` +
            `(low downloads and/or recent age). This is the classic typosquatting or slopsquatting profile ` +
            `exploited when AI almost remembers a well-known package name.`,
          `The package "${pkg.name}" resembles "${typosquatOf}" but is not the same package. ` +
            `Verify whether this is a typo or hallucination. If so, replace every occurrence with "${typosquatOf}" ` +
            `in ${pkg.file} and manifests, then reinstall dependencies.`,
          pkg.name,
          { typosquatOf, weeklyDownloads: info.weeklyDownloads, ageDays },
        ),
      );
    }
  }

  return findings;
}

/** Apply Phase-1 resolution; drop excluded specifiers. */
export function resolvePackages(
  packages: DeclaredPackage[],
  index: ProjectResolveIndex,
): ResolvedPackage[] {
  const out: ResolvedPackage[] = [];
  for (const pkg of packages) {
    const resolution = resolveSpecifier({
      specifier: pkg.specifier,
      packageName: pkg.name,
      ecosystem: pkg.ecosystem,
      source: pkg.source,
      index,
    });
    if (resolution.action === "exclude") continue;
    out.push({ ...pkg, resolution });
  }
  return out;
}

export interface GhostDepsScanResult {
  findings: Finding[];
  filesReceived: number;
  filesAnalyzed: number;
  files: string[];
  discoveryPatterns: string[];
}

export async function runGhostDepsAnalysis(
  rootDir: string,
  registry: RegistryClient,
  options: GhostDepsOptions = {},
  now = new Date(),
  onIssue?: (issue: {
    code: string;
    message: string;
    file: string;
  }) => void,
): Promise<GhostDepsScanResult> {
  const opts: Required<GhostDepsOptions> = {
    maxAgeDays: options.maxAgeDays ?? DEFAULTS.maxAgeDays,
    minWeeklyDownloads: options.minWeeklyDownloads ?? DEFAULTS.minWeeklyDownloads,
    lowDownloadMaxAgeDays:
      options.lowDownloadMaxAgeDays ?? DEFAULTS.lowDownloadMaxAgeDays,
  };

  const index = await buildProjectResolveIndex(rootDir);
  const collected = await collectPackagesDetailed(rootDir, onIssue);
  const packages = resolvePackages(collected.packages, index);
  // Keep registry traffic bounded while avoiding one-request-at-a-time scans
  // on monorepos. Promise results retain package order for deterministic output.
  const analyzed = await mapWithConcurrency(
    packages,
    REGISTRY_LOOKUP_CONCURRENCY,
    async (pkg) => {
      // Blind packages still get a registry lookup when possible, so we can
      // confirm nonexistence and attach the "possible alias" note at HIGH.
      const info = await registry.lookup(pkg.ecosystem, pkg.name);
      if (info.exists === undefined) {
        onIssue?.({
          code: info.lookupIssue?.code ?? "registry-lookup-unknown",
          message:
            info.lookupIssue?.message ??
            `Could not verify ${pkg.ecosystem} package "${pkg.name}".`,
          file: pkg.file,
        });
      }
      return analyzePackage(pkg, info, opts, now);
    },
  );
  const findings = analyzed.flat();

  return {
    findings,
    filesReceived: collected.filesReceived,
    filesAnalyzed: collected.filesAnalyzed,
    files: collected.files,
    discoveryPatterns: [...GHOST_DEPS_DISCOVERY_PATTERNS],
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let stopped = false;
  let firstError: unknown;
  const worker = async (): Promise<void> => {
    while (!stopped && nextIndex < values.length) {
      const index = nextIndex++;
      try {
        results[index] = await fn(values[index]!);
      } catch (error) {
        stopped = true;
        firstError ??= error;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker(),
    ),
  );
  if (firstError !== undefined) throw firstError;
  return results;
}
