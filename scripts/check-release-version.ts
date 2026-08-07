import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { VERSION } from "../src/version.ts";

const root = join(import.meta.dir, "..");
const pkg = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
) as { version?: string };
const tag = process.argv[2];

if (!pkg.version || pkg.version !== VERSION) {
  throw new Error(
    `Version mismatch: package.json=${pkg.version ?? "missing"}, src/version.ts=${VERSION}`,
  );
}

if (tag && tag !== `v${VERSION}`) {
  throw new Error(
    `Release tag mismatch: expected v${VERSION}, received ${tag}`,
  );
}

console.log(
  tag
    ? `Release version verified: ${tag}`
    : `Version files verified: ${VERSION}`,
);
