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
      const issues: string[] = [];
      const client = new HttpRegistryClient({
        cache: new RegistryCache(dir),
        timeoutMs: 5,
        maxRetries: 0,
        onIssue: (issue) => issues.push(issue.code),
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
      expect(issues).toEqual(["registry-lookup-failed"]);
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
      const issues: string[] = [];
      const client = new HttpRegistryClient({
        cache: new RegistryCache(dir),
        offline: true,
        onIssue: (issue) => issues.push(issue.code),
      });
      const info = await client.lookup("pypi", "missing-cache-entry");
      expect(info.exists).toBeUndefined();
      expect(issues).toEqual(["registry-offline-cache-miss"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
