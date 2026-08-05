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
