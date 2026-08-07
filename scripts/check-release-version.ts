import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { VERSION } from "../src/version.ts";

const root = join(import.meta.dir, "..");
const pkg = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
) as { version?: string };
const action = parse(
  await readFile(join(root, "action.yml"), "utf8"),
) as { inputs?: { version?: { default?: string } } };
const readme = await readFile(join(root, "README.md"), "utf8");
const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
const tag = process.argv[2];

const actionVersion = action.inputs?.version?.default;
if (
  !pkg.version ||
  pkg.version !== VERSION ||
  actionVersion !== VERSION
) {
  throw new Error(
    `Version mismatch: package.json=${pkg.version ?? "missing"}, src/version.ts=${VERSION}, action.yml=${actionVersion ?? "missing"}`,
  );
}

if (!readme.includes(`NovaCoding-G/NovaCheck@v${VERSION}`)) {
  throw new Error(`README does not reference Action v${VERSION}`);
}

const changelogHeading = changelog.match(
  new RegExp(`^## \\[${VERSION.replaceAll(".", "\\.")}\\] - (.+)$`, "m"),
);
if (!changelogHeading) {
  throw new Error(`CHANGELOG has no dated ${VERSION} release section`);
}

if (tag && tag !== `v${VERSION}`) {
  throw new Error(
    `Release tag mismatch: expected v${VERSION}, received ${tag}`,
  );
}
if (tag && changelogHeading[1]?.trim().toLowerCase() === "unreleased") {
  throw new Error(`CHANGELOG ${VERSION} section is still marked Unreleased`);
}

console.log(
  tag
    ? `Release version verified: ${tag}`
    : `Version files verified: ${VERSION}`,
);
