import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpRegistryClient } from "../../src/detectors/ghost-deps/registry/http-client.ts";
import { RegistryCache } from "../../src/detectors/ghost-deps/registry/cache.ts";

describe("RegistryCache", () => {
  test("round-trips package info", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novacheck-cache-"));
    try {
      const cache = new RegistryCache(dir, 60_000);
      await cache.set({
        name: "react",
        ecosystem: "npm",
        exists: true,
        createdAt: new Date("2013-05-29T00:00:00.000Z"),
        weeklyDownloads: 1_000_000,
      });

      const hit = await cache.get("npm", "react");
      expect(hit?.exists).toBe(true);
      expect(hit?.weeklyDownloads).toBe(1_000_000);
      expect(hit?.createdAt?.toISOString()).toBe("2013-05-29T00:00:00.000Z");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("expires after ttl", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novacheck-cache-"));
    try {
      const cache = new RegistryCache(dir, 1);
      await cache.set({ name: "x", ecosystem: "npm", exists: false });
      await Bun.sleep(5);
      const hit = await cache.get("npm", "x");
      expect(hit).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("HttpRegistryClient resilience", () => {
  test("retries transient registry failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novacheck-registry-"));
    try {
      let metadataAttempts = 0;
      const client = new HttpRegistryClient({
        cache: new RegistryCache(dir),
        maxRetries: 2,
        retryBaseDelayMs: 0,
        fetchImpl: (async (input: string | URL | Request) => {
          const url = String(input);
          if (url.includes("/downloads/")) {
            return Response.json({ downloads: 1_000 });
          }
          metadataAttempts++;
          if (metadataAttempts < 3) {
            return new Response("", { status: 503 });
          }
          return Response.json({
            time: { created: "2013-05-29T00:00:00.000Z" },
          });
        }) as typeof fetch,
      });

      const info = await client.lookup("npm", "react");
      expect(metadataAttempts).toBe(3);
      expect(info.exists).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports timeout and does not cache unknown lookups", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novacheck-registry-"));
    try {
      const client = new HttpRegistryClient({
        cache: new RegistryCache(dir),
        timeoutMs: 5,
        maxRetries: 0,
        fetchImpl: ((_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true },
            );
          })) as typeof fetch,
      });

      const info = await client.lookup("npm", "never-responds");
      expect(info.exists).toBeUndefined();
      expect(info.lookupIssue?.code).toBe("registry-lookup-failed");
      expect(
        await new RegistryCache(dir).get("npm", "never-responds"),
      ).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("marks offline cache misses as incomplete", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novacheck-registry-"));
    try {
      const client = new HttpRegistryClient({
        cache: new RegistryCache(dir),
        offline: true,
      });
      const info = await client.lookup("pypi", "missing-cache-entry");
      expect(info.exists).toBeUndefined();
      expect(info.lookupIssue?.code).toBe("registry-offline-cache-miss");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("applies timeout while reading a stalled response body", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novacheck-registry-"));
    try {
      const client = new HttpRegistryClient({
        cache: new RegistryCache(dir),
        timeoutMs: 5,
        maxRetries: 0,
        fetchImpl: (async () =>
          ({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: () => new Promise<never>(() => {}),
          }) as unknown as Response) as unknown as typeof fetch,
      });
      const started = Date.now();
      const info = await client.lookup("npm", "stalled-body");
      expect(Date.now() - started).toBeLessThan(200);
      expect(info.exists).toBeUndefined();
      expect(info.lookupIssue?.code).toBe("registry-lookup-failed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("propagates cancellation during optional download lookup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "novacheck-registry-"));
    try {
      const controller = new AbortController();
      const client = new HttpRegistryClient({
        cache: new RegistryCache(dir),
        signal: controller.signal,
        maxRetries: 0,
        fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
          if (!String(input).includes("/downloads/")) {
            return Response.json({
              time: { created: "2013-05-29T00:00:00.000Z" },
            });
          }
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true },
            );
          });
        }) as typeof fetch,
      });

      const lookup = client.lookup("npm", "react");
      setTimeout(() => controller.abort(new Error("cancelled")), 5);
      await expect(lookup).rejects.toThrow("cancelled");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
