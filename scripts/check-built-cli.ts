import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
  version: string;
};
const { stdout } = await execFileAsync(
  "node",
  ["dist/cli.js", "--version"],
  { encoding: "utf8" },
);
const expected = `novacheck ${pkg.version}`;
if (stdout.trim() !== expected) {
  throw new Error(
    `Built CLI version mismatch: expected "${expected}", got "${stdout.trim()}".`,
  );
}

const bundle = await readFile("dist/cli.js", "utf8");
if (bundle.includes("vuln-deps") || bundle.includes("api.osv.dev")) {
  throw new Error("Built CLI contains the removed vuln-deps detector.");
}

console.log(`Built CLI verified: ${expected}`);
