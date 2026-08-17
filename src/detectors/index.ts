import type { Detector } from "../types/index.ts";
import { aiPresenceDetector } from "./ai-presence/index.ts";
import { aiUnreviewedDetector } from "./ai-unreviewed/index.ts";
import { dangerousSinksDetector } from "./dangerous-sinks/index.ts";
import { envLeakDetector } from "./env-leak/index.ts";
import { ghostDepsDetector } from "./ghost-deps/index.ts";
import { insecureCryptoDetector } from "./insecure-crypto/index.ts";
import { secretsDetector } from "./secrets/index.ts";
import { supplyChainDetector } from "./supply-chain/index.ts";

/** Ordered list of detectors — security first, then AI provenance/presence. */
export const detectors: Detector[] = [
  ghostDepsDetector,
  secretsDetector,
  envLeakDetector,
  supplyChainDetector,
  dangerousSinksDetector,
  insecureCryptoDetector,
  aiUnreviewedDetector,
  aiPresenceDetector,
];

export const DETECTOR_IDS: readonly string[] = detectors.map((d) => d.id);

export interface DetectorSelection {
  /** Run only these detectors, in the default order. */
  only?: readonly string[];
  /** Run everything except these detectors. */
  skip?: readonly string[];
}

/**
 * Narrow a scan to specific detectors. Unknown ids fail loudly: a gate that
 * silently runs fewer checks than requested is worse than no gate.
 */
export function selectDetectors(
  selection: DetectorSelection = {},
  list: readonly Detector[] = detectors,
): Detector[] {
  const known = new Set(list.map((d) => d.id));
  for (const id of [...(selection.only ?? []), ...(selection.skip ?? [])]) {
    if (!known.has(id)) {
      throw new Error(
        `Unknown detector "${id}". Available: ${[...known].join(", ")}.`,
      );
    }
  }

  const only = selection.only?.length ? new Set(selection.only) : undefined;
  const skip = new Set(selection.skip ?? []);
  const selected = list.filter(
    (d) => (!only || only.has(d.id)) && !skip.has(d.id),
  );
  if (selected.length === 0) {
    throw new Error("Detector selection is empty: nothing would be scanned.");
  }
  return selected;
}

export { ghostDepsDetector, createGhostDepsDetector } from "./ghost-deps/index.ts";
export { secretsDetector, createSecretsDetector } from "./secrets/index.ts";
export {
  dangerousSinksDetector,
  createDangerousSinksDetector,
} from "./dangerous-sinks/index.ts";
export {
  aiUnreviewedDetector,
  createAiUnreviewedDetector,
} from "./ai-unreviewed/index.ts";
export {
  supplyChainDetector,
  createSupplyChainDetector,
} from "./supply-chain/index.ts";
export { envLeakDetector, createEnvLeakDetector } from "./env-leak/index.ts";
export {
  insecureCryptoDetector,
  createInsecureCryptoDetector,
} from "./insecure-crypto/index.ts";
export {
  aiPresenceDetector,
  createAiPresenceDetector,
} from "./ai-presence/index.ts";
