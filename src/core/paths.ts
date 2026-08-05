import { homedir } from "node:os";
import { join } from "node:path";

/** Shared cache root across projects (~/.novacheck/cache). */
export function defaultCacheDir(): string {
  return join(homedir(), ".novacheck", "cache");
}
