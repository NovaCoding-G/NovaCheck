import type { Ecosystem, PackageInfo, RegistryClient } from "../types.ts";
import { RegistryCache } from "./cache.ts";

export interface HttpRegistryClientOptions {
  cache: RegistryCache;
  offline?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  onIssue?: (issue: { code: string; message: string }) => void;
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
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly onIssue?: HttpRegistryClientOptions["onIssue"];

  constructor(options: HttpRegistryClientOptions) {
    this.cache = options.cache;
    this.offline = options.offline ?? false;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.signal = options.signal;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
    this.onIssue = options.onIssue;
  }

  async lookup(ecosystem: Ecosystem, name: string): Promise<PackageInfo> {
    const cached = await this.cache.get(ecosystem, name);
    if (cached) return cached;

    if (this.offline) {
      this.onIssue?.({
        code: "registry-offline-cache-miss",
        message: `Could not verify ${ecosystem} package "${name}" because offline mode had no cached response.`,
      });
      return { name, ecosystem, exists: undefined };
    }

    const info =
      ecosystem === "npm"
        ? await this.lookupNpm(name)
        : await this.lookupPypi(name);

    // Never cache transient failures or offline misses.
    if (info.exists !== undefined) await this.cache.set(info);
    return info;
  }

  private async lookupNpm(name: string): Promise<PackageInfo> {
    const encoded = name
      .split("/")
      .map((p) => encodeURIComponent(p))
      .join("/");

    const metaRes = await this.request(
      `https://registry.npmjs.org/${encoded}`,
      { headers: { Accept: "application/json" } },
    );

    if (!metaRes) {
      this.reportLookupFailure("npm", name, "network error or timeout");
      return { name, ecosystem: "npm", exists: undefined };
    }

    if (metaRes.status === 404) {
      return { name, ecosystem: "npm", exists: false };
    }
    if (!metaRes.ok) {
      this.reportLookupFailure("npm", name, `HTTP ${metaRes.status}`);
      return { name, ecosystem: "npm", exists: undefined };
    }

    const meta = (await metaRes.json()) as {
      time?: Record<string, string>;
    };

    const createdRaw = meta.time?.created;
    const createdAt = createdRaw ? new Date(createdRaw) : undefined;

    let weeklyDownloads: number | undefined;
    try {
      const dlRes = await this.request(
        `https://api.npmjs.org/downloads/point/last-week/${encoded}`,
        {},
      );
      if (dlRes?.ok) {
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
    const res = await this.request(
      `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
      { headers: { Accept: "application/json" } },
    );

    if (!res) {
      this.reportLookupFailure("pypi", name, "network error or timeout");
      return { name, ecosystem: "pypi", exists: undefined };
    }
    if (res.status === 404) {
      return { name, ecosystem: "pypi", exists: false };
    }
    if (!res.ok) {
      this.reportLookupFailure("pypi", name, `HTTP ${res.status}`);
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

  private reportLookupFailure(
    ecosystem: Ecosystem,
    name: string,
    reason: string,
  ): void {
    this.onIssue?.({
      code: "registry-lookup-failed",
      message: `Could not verify ${ecosystem} package "${name}": ${reason}.`,
    });
  }

  private async request(
    url: string,
    init: RequestInit,
  ): Promise<Response | undefined> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const timed = createTimedSignal(this.signal, this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          ...init,
          signal: timed.signal,
        });
        if (
          isRetryableStatus(response.status) &&
          attempt < this.maxRetries
        ) {
          const retryAfter = retryAfterMs(response);
          await delay(
            Math.min(
              5_000,
              retryAfter ??
                this.retryBaseDelayMs * Math.pow(2, attempt),
            ),
            this.signal,
          );
          continue;
        }
        return response;
      } catch (error) {
        if (this.signal?.aborted) throw error;
        if (attempt >= this.maxRetries) return undefined;
        await delay(
          this.retryBaseDelayMs * Math.pow(2, attempt),
          this.signal,
        );
      } finally {
        timed.cleanup();
      }
    }
    return undefined;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function createTimedSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error(`Registry request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
