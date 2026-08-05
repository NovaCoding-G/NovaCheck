import { resolve } from "node:path";
import { detectors as defaultDetectors } from "../detectors/index.ts";
import { computeTrustScore, sortFindings } from "../scoring/trust-score.ts";
import type { Detector, ScanResult } from "../types/index.ts";
import { createScanContext, type CreateContextOptions } from "./create-context.ts";

export interface ScanOptions extends Omit<CreateContextOptions, "rootDir"> {
  rootDir: string;
  /** Override detector list (tests). */
  detectors?: Detector[];
}

/** Run all detectors and assemble a ScanResult with Trust Score. */
export async function runScan(options: ScanOptions): Promise<ScanResult> {
  const rootDir = resolve(options.rootDir);
  const started = Date.now();
  const { ctx, skips, getDiagnostics } = createScanContext({
    rootDir,
    cacheDir: options.cacheDir,
    offline: options.offline,
    signal: options.signal,
  });

  const list = options.detectors ?? defaultDetectors;
  const detectorsRun: string[] = [];
  const findings = [];

  for (const detector of list) {
    const result = await detector.run(ctx);
    findings.push(...result);
    detectorsRun.push(detector.id);
  }

  const diagnostics = getDiagnostics(
    list.map((d) => ({ id: d.id, name: d.name })),
  );
  const findingsByDetector = new Map<string, number>();
  for (const f of findings) {
    findingsByDetector.set(
      f.detectorId,
      (findingsByDetector.get(f.detectorId) ?? 0) + 1,
    );
  }
  for (const d of diagnostics.detectors) {
    d.findingsCount = findingsByDetector.get(d.detectorId) ?? 0;
    const skip = skips.find((s) => s.id === d.detectorId);
    if (skip) {
      d.status = "skipped";
      d.skipReason = skip.reason;
    }
  }

  const sorted = sortFindings(findings);
  return {
    trustScore: computeTrustScore(sorted),
    findings: sorted,
    detectorsRun,
    detectorsSkipped: [...skips],
    diagnostics,
    scannedAt: new Date().toISOString(),
    rootDir,
    durationMs: Date.now() - started,
  };
}
