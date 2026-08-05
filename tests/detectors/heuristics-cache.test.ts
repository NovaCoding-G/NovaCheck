import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
