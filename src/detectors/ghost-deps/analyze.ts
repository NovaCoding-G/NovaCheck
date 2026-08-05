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
      : "nessuno";
  return `Resolver applicati: ${applied}. Resolver saltati: ${skipped}.`;
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
          `Specificatore ambiguo (alias non risolto): ${pkg.name}`,
          `Non è stato possibile verificare \`${pkg.name}\` sul registry e il resolver è cieco ` +
            `su config di alias/bundler. Possibile alias non risolto — verifica prima di trattarlo come dipendenza esterna.`,
          `Verifica se "${pkg.name}" in ${pkg.file}` +
            (pkg.line ? `:${pkg.line}` : "") +
            ` è un alias locale (tsconfig paths, vite/webpack resolve.alias, workspace) oppure un pacchetto esterno. ` +
            `Se è un alias, non aggiungerlo al manifest; se è esterno, conferma il nome corretto sul registry.`,
          pkg.name,
          { blind: true },
        ),
      );
    }
    return findings;
  }

  if (info.exists === false) {
    const whyTypo = typosquatOf
      ? ` Il nome è anche molto simile a \`${typosquatOf}\`, un pacchetto popolare: tipico pattern di slopsquatting / typosquatting.`
      : "";

    // Blind → HIGH (possible unresolved alias). High-confidence external → CRITICAL.
    // Typosquat of a popular name is always CRITICAL even under blind resolution.
    const severity: Finding["severity"] =
      typosquatOf || !blind ? "critical" : "high";

    const blindNote = blind
      ? " Possibile alias non risolto — verifica (il resolver non ha potuto escludere alias/bundler)."
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
        `Pacchetto inesistente su ${registry}: ${pkg.name}`,
        `Il pacchetto \`${pkg.name}\` risulta dichiarato o importato, ma non esiste su ${registry}. ` +
          `Nei progetti generati dall'AI questo spesso indica un'allucinazione (slopsquatting): ` +
          `un nome inventato che un attaccante può registrare e riempire di malware.${whyTypo}${blindNote}`,
        `Nel progetto, il pacchetto "${pkg.name}" (${registry}) non esiste sul registry. ` +
          `Trova ogni riferimento in ${pkg.file}` +
          (pkg.line ? ` (riga ${pkg.line})` : "") +
          ` e nei manifest. ` +
          (blind
            ? `Prima di tutto verifica se è un alias locale (tsconfig paths, vite/webpack resolve.alias, workspace). `
            : "") +
          `Sostituiscilo con il pacchetto corretto e mantenuto` +
          (typosquatOf ? ` (forse intendevi "${typosquatOf}")` : "") +
          `, aggiorna le dipendenze e verifica che build/test passino. Non pubblicare finché il nome fantasma non è rimosso.`,
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
        `Pacchetto molto recente su ${registry}: ${pkg.name}`,
        `"${pkg.name}" esiste su ${registry} da soli ~${Math.max(0, Math.floor(ageDays))} giorni. ` +
          `I pacchetti creati da pochissimo sono un vettore comune dopo allucinazioni AI: ` +
          `qualcuno registra il nome inventato e ci mette codice malevolo. Verifica maintainer, repo e download prima di fidarti.`,
        `Il pacchetto "${pkg.name}" su ${registry} è stato pubblicato da meno di ${options.maxAgeDays} giorni. ` +
          `Valuta se è intenzionale: controlla la pagina del registry, il repository e i maintainer. ` +
          `Se non sei sicuro, sostituiscilo con un'alternativa matura e aggiorna ${pkg.file}.`,
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
        `Pochi download settimanali: ${pkg.name}`,
        `"${pkg.name}" ha ~${info.weeklyDownloads} download nell'ultima settimana su npm e non è un pacchetto maturo. ` +
          `Combinato con codice AI, i pacchetti poco usati e recenti meritano una verifica manuale del maintainer e del contenuto.`,
        `Il pacchetto npm "${pkg.name}" ha meno di ${options.minWeeklyDownloads} download settimanali e ha meno di ${options.lowDownloadMaxAgeDays} giorni. ` +
          `Conferma che sia il pacchetto giusto (non un typosquat), altrimenti sostituiscilo con l'alternativa popolare corretta e aggiorna ${pkg.file}.`,
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
          `Nome sospetto (simile a ${typosquatOf}): ${pkg.name}`,
          `"${pkg.name}" è molto simile al pacchetto popolare \`${typosquatOf}\` e ha segnali deboli ` +
            `(pochi download e/o età recente). È il classico profilo di typosquatting / slopsquatting ` +
            `sfruttato quando l'AI "quasi" ricorda un nome famoso.`,
          `Il pacchetto "${pkg.name}" assomiglia a "${typosquatOf}" ma non è quello. ` +
            `Verifica se è un errore di digitazione/allucinazione. Se sì, sostituisci tutte le occorrenze con "${typosquatOf}" ` +
            `in ${pkg.file} e nei manifest, poi reinstalla le dipendenze.`,
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
): Promise<GhostDepsScanResult> {
  const opts: Required<GhostDepsOptions> = {
    maxAgeDays: options.maxAgeDays ?? DEFAULTS.maxAgeDays,
    minWeeklyDownloads: options.minWeeklyDownloads ?? DEFAULTS.minWeeklyDownloads,
    lowDownloadMaxAgeDays:
      options.lowDownloadMaxAgeDays ?? DEFAULTS.lowDownloadMaxAgeDays,
  };

  const index = await buildProjectResolveIndex(rootDir);
  const collected = await collectPackagesDetailed(rootDir);
  const packages = resolvePackages(collected.packages, index);
  const findings: Finding[] = [];

  for (const pkg of packages) {
    // Blind packages still get a registry lookup when possible, so we can
    // confirm nonexistence and attach the "possibile alias" note at HIGH.
    const info = await registry.lookup(pkg.ecosystem, pkg.name);
    findings.push(...analyzePackage(pkg, info, opts, now));
  }

  return {
    findings,
    filesReceived: collected.filesReceived,
    filesAnalyzed: collected.filesAnalyzed,
    files: collected.files,
    discoveryPatterns: [...GHOST_DEPS_DISCOVERY_PATTERNS],
  };
}
