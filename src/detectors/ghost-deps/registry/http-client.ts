import type { Ecosystem, PackageInfo, RegistryClient } from "../types.ts";
import { RegistryCache } from "./cache.ts";

export interface HttpRegistryClientOptions {
  cache: RegistryCache;
  offline?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Live npm + PyPI lookups with on-disk cache.
 * Offline mode: cache hits only; misses → exists: undefined (no finding).
 */
export class HttpRegistryClient implements RegistryClient {
  private readonly cache: RegistryCache;
  private readonly offline: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly signal?: AbortSignal;

  constructor(options: HttpRegistryClientOptions) {
    this.cache = options.cache;
    this.offline = options.offline ?? false;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.signal = options.signal;
  }

  async lookup(ecosystem: Ecosystem, name: string): Promise<PackageInfo> {
    const cached = await this.cache.get(ecosystem, name);
    if (cached) return cached;

    if (this.offline) {
      return { name, ecosystem, exists: undefined };
    }

    const info =
      ecosystem === "npm"
        ? await this.lookupNpm(name)
        : await this.lookupPypi(name);

    await this.cache.set(info);
    return info;
  }

  private async lookupNpm(name: string): Promise<PackageInfo> {
    const encoded = name
      .split("/")
      .map((p) => encodeURIComponent(p))
      .join("/");

    const metaRes = await this.fetchImpl(`https://registry.npmjs.org/${encoded}`, {
      signal: this.signal,
      headers: { Accept: "application/json" },
    });

    if (metaRes.status === 404) {
      return { name, ecosystem: "npm", exists: false };
    }
    if (!metaRes.ok) {
      // Transient / rate-limit: do not invent a finding
      return { name, ecosystem: "npm", exists: undefined };
    }

    const meta = (await metaRes.json()) as {
      time?: Record<string, string>;
    };

    const createdRaw = meta.time?.created;
    const createdAt = createdRaw ? new Date(createdRaw) : undefined;

    let weeklyDownloads: number | undefined;
    try {
      const dlRes = await this.fetchImpl(
        `https://api.npmjs.org/downloads/point/last-week/${encoded}`,
        { signal: this.signal },
      );
      if (dlRes.ok) {
        const dl = (await dlRes.json()) as { downloads?: number };
        weeklyDownloads = dl.downloads;
      }
    } catch {
      // downloads are optional for the heuristic
    }

    return {
      name,
      ecosystem: "npm",
      exists: true,
      createdAt,
      weeklyDownloads,
    };
  }

  private async lookupPypi(name: string): Promise<PackageInfo> {
    const res = await this.fetchImpl(
      `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
      { signal: this.signal, headers: { Accept: "application/json" } },
    );

    if (res.status === 404) {
      return { name, ecosystem: "pypi", exists: false };
    }
    if (!res.ok) {
      return { name, ecosystem: "pypi", exists: undefined };
    }

    const data = (await res.json()) as {
      info?: { name?: string };
      releases?: Record<string, Array<{ upload_time_iso_8601?: string; upload_time?: string }>>;
      urls?: Array<{ uploads?: unknown }>;
    };

    let createdAt: Date | undefined;
    const releases = data.releases ?? {};
    for (const files of Object.values(releases)) {
      for (const file of files) {
        const raw = file.upload_time_iso_8601 ?? file.upload_time;
        if (!raw) continue;
        const d = new Date(raw);
        if (!createdAt || d < createdAt) createdAt = d;
      }
    }

    // PyPI JSON has no download counts in the public API without extra services.
    // We still use age + existence + typosquat for PyPI.
    return {
      name,
      ecosystem: "pypi",
      exists: true,
      createdAt,
    };
  }
}
