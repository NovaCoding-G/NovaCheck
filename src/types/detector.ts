import type { Finding } from "./finding.ts";
import type { ScanContext } from "./scan-context.ts";

/**
 * Independent scan module. Detectors must not depend on each other.
 * A detector that cannot run (missing provenance, etc.) returns [] and
 * may record a skip via ctx.skip() — never throw for "not applicable".
 */
export interface Detector {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  run(ctx: ScanContext): Promise<Finding[]>;
}
