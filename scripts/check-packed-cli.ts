import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "../src/version.ts";

const root = join(import.meta.dir, "..");
const work = await mkdtemp(join(tmpdir(), "novacheck-package-smoke-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  execFileSync(npm, ["pack", "--pack-destination", work, "--silent"], {
    cwd: root,
    stdio: "pipe",
  });
  const archive = (await readdir(work)).find((file) => file.endsWith(".tgz"));
  if (!archive) throw new Error("npm pack did not produce a .tgz archive");

  execFileSync(npm, ["init", "--yes", "--silent"], {
    cwd: work,
    stdio: "pipe",
  });
  execFileSync(npm, ["install", join(work, archive), "--silent"], {
    cwd: work,
    stdio: "pipe",
  });

  const cli = join(
    work,
    "node_modules",
    "novacheck",
    "dist",
    "cli.js",
  );
  const version = execFileSync(process.execPath, [cli, "--version"], {
    cwd: work,
    encoding: "utf8",
  }).trim();
  if (version !== `novacheck ${VERSION}`) {
    throw new Error(`Unexpected packed CLI version: ${version}`);
  }

  execFileSync(process.execPath, [cli, "--help"], {
    cwd: work,
    stdio: "pipe",
  });
  const output = execFileSync(
    process.execPath,
    [
      cli,
      join(root, "tests", "fixtures", "secrets", "clean-app"),
      "--offline",
      "--allow-incomplete",
      "--no-html",
      "--verbose",
    ],
    { cwd: work, encoding: "utf8" },
  );
  if (
    !output.includes("Trust Score") ||
    !/dangerous-sinks[\s\S]{0,240}files received: \d+ · analyzed: [1-9]\d*/.test(
      output,
    )
  ) {
    throw new Error("Packed CLI did not complete the parser-backed smoke scan");
  }

  console.log(`Packed CLI verified on Node ${process.version}: ${version}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
