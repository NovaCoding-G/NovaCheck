import type {
  DetectorRunStats,
  DetectorSkip,
  ScanContext,
  ScanDiagnostics,
} from "../types/index.ts";
import { defaultCacheDir } from "./paths.ts";

export interface CreateContextOptions {
  rootDir: string;
  cacheDir?: string;
  offline?: boolean;
  signal?: AbortSignal;
}

export function createScanContext(options: CreateContextOptions): {
  ctx: ScanContext;
  skips: DetectorSkip[];
  getDiagnostics: (registered: Array<{ id: string; name: string }>) => ScanDiagnostics;
} {
  const skips: DetectorSkip[] = [];
  const statsById = new Map<string, DetectorRunStats>();
  const allFiles = new Set<string>();

  const ctx: ScanContext = {
    rootDir: options.rootDir,
    cacheDir: options.cacheDir ?? defaultCacheDir(),
    offline: options.offline ?? false,
    signal: options.signal,
    skip(detectorId, reason) {
      skips.push({ id: detectorId, reason });
      const prev = statsById.get(detectorId);
      if (prev) {
        prev.status = "skipped";
        prev.skipReason = reason;
      } else {
        statsById.set(detectorId, {
          detectorId,
          name: detectorId,
          status: "skipped",
          skipReason: reason,
          filesReceived: 0,
          filesAnalyzed: 0,
          discoveryPatterns: [],
          findingsCount: 0,
        });
      }
    },
    recordStats(stats) {
      for (const f of stats.files ?? []) allFiles.add(f);
      const existing = statsById.get(stats.detectorId);
      const skip = skips.find((s) => s.id === stats.detectorId);
      statsById.set(stats.detectorId, {
        detectorId: stats.detectorId,
        name: stats.name,
        status: skip ? "skipped" : (existing?.status === "skipped" ? "skipped" : "ran"),
        skipReason: skip?.reason ?? existing?.skipReason,
        filesReceived: stats.filesReceived,
        filesAnalyzed: stats.filesAnalyzed,
        discoveryPatterns: stats.discoveryPatterns,
        findingsCount: stats.findingsCount ?? existing?.findingsCount ?? 0,
      });
    },
  };

  function getDiagnostics(
    registered: Array<{ id: string; name: string }>,
  ): ScanDiagnostics {
    const detectors: DetectorRunStats[] = registered.map((d) => {
      const recorded = statsById.get(d.id);
      if (recorded) {
        return { ...recorded, name: recorded.name || d.name };
      }
      const skip = skips.find((s) => s.id === d.id);
      return {
        detectorId: d.id,
        name: d.name,
        status: skip ? "skipped" : "ran",
        skipReason: skip?.reason,
        filesReceived: 0,
        filesAnalyzed: 0,
        discoveryPatterns: [],
        findingsCount: 0,
      };
    });

    const patternSet = new Set<string>();
    let totalFilesReceived = 0;
    for (const d of detectors) {
      totalFilesReceived += d.filesReceived;
      for (const p of d.discoveryPatterns) patternSet.add(p);
    }

    return {
      detectors,
      totalFilesReceived,
      uniqueFilesTouched: allFiles.size,
      discoveryPatterns: [...patternSet],
    };
  }

  return { ctx, skips, getDiagnostics };
}
