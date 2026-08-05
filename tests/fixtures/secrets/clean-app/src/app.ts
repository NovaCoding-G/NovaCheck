import { readFileSync } from "node:fs";

const apiKey = process.env.API_KEY ?? "";
const dbUrl = process.env.DATABASE_URL ?? "";

export function boot() {
  if (!apiKey) throw new Error("API_KEY missing");
  void dbUrl;
  void readFileSync;
  return { ok: true };
}
