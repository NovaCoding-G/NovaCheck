export type {
  Severity,
  Finding,
  Detector,
  ScanContext,
  ScanResult,
  DetectorSkip,
  DetectorRunStats,
  ScanDiagnostics,
} from "./types/index.ts";
export { SEVERITY_ORDER, SEVERITY_WEIGHT } from "./types/index.ts";
export { VERSION } from "./version.ts";
export { createScanContext } from "./core/create-context.ts";
export { runScan } from "./core/scan.ts";
export {
  getChangedFiles,
  filterResultToChangedFiles,
} from "./core/git-diff.ts";
export { defaultCacheDir } from "./core/paths.ts";
export {
  loadPolicy,
  applyPolicy,
  policyFailureReasons,
} from "./config/policy.ts";
export type { NovaCheckPolicy, LoadedPolicy } from "./config/policy.ts";
export {
  computeTrustScore,
  sortFindings,
  topPriorityFindings,
  countBySeverity,
  scoreBand,
} from "./scoring/trust-score.ts";
export {
  formatTerminalReport,
  formatVerboseDiagnostics,
} from "./reporters/terminal.ts";
export { formatHtmlReport } from "./reporters/html.ts";
export { formatSarifReport } from "./reporters/sarif.ts";
export { formatBadgeMarkdown, formatBadgeSvg } from "./reporters/badge.ts";
export {
  detectors,
  ghostDepsDetector,
  createGhostDepsDetector,
  secretsDetector,
  createSecretsDetector,
  dangerousSinksDetector,
  createDangerousSinksDetector,
  aiUnreviewedDetector,
  createAiUnreviewedDetector,
  supplyChainDetector,
  createSupplyChainDetector,
  envLeakDetector,
  createEnvLeakDetector,
  insecureCryptoDetector,
  createInsecureCryptoDetector,
  aiPresenceDetector,
  createAiPresenceDetector,
} from "./detectors/index.ts";
