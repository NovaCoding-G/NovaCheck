import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Ecosystem, PackageInfo } from "../types.ts";

interface CacheEntry {
  fetchedAt: string;
  info: {
    name: string;
    ecosystem: Ecosystem;
    exists: boolean | undefined;
    createdAt?: string;
    weeklyDownloads?: number;
  };
}

/** Default TTL: 24 hours. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(ecosystem: Ecosystem, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9@._+-]/g, "_");
  return `${ecosystem}__${safe}.json`;
}

export class RegistryCache {
  constructor(
    private readonly cacheDir: string,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  private dir(): string {
    return join(this.cacheDir, "registry");
  }

  async get(ecosystem: Ecosystem, name: string): Promise<PackageInfo | undefined> {
    try {
      const raw = await readFile(join(this.dir(), cacheKey(ecosystem, name)), "utf8");
      const entry = JSON.parse(raw) as CacheEntry;
      const age = Date.now() - new Date(entry.fetchedAt).getTime();
      if (age > this.ttlMs) return undefined;
      return {
        name: entry.info.name,
        ecosystem: entry.info.ecosystem,
        exists: entry.info.exists,
        createdAt: entry.info.createdAt ? new Date(entry.info.createdAt) : undefined,
        weeklyDownloads: entry.info.weeklyDownloads,
      };
    } catch {
      return undefined;
    }
  }

  async set(info: PackageInfo): Promise<void> {
    await mkdir(this.dir(), { recursive: true });
    const entry: CacheEntry = {
      fetchedAt: new Date().toISOString(),
      info: {
        name: info.name,
        ecosystem: info.ecosystem,
        exists: info.exists,
        createdAt: info.createdAt?.toISOString(),
        weeklyDownloads: info.weeklyDownloads,
      },
    };
    await writeFile(
      join(this.dir(), cacheKey(info.ecosystem, info.name)),
      JSON.stringify(entry),
      "utf8",
    );
  }
}
