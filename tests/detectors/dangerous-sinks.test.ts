import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  analyzeSource,
  createDangerousSinksDetector,
  runDangerousSinksScan,
} from "../../src/detectors/dangerous-sinks/index.ts";
import { createScanContext } from "../../src/core/create-context.ts";

const FIXTURES = join(import.meta.dir, "../fixtures/dangerous-sinks");

/** Snippet vulnerabile solo per test del detector — non nella demo js-app. */
const VULNERABLE_JS = `
import { exec, spawn } from "node:child_process";
import cors from "cors";
import https from "node:https";

export function unsafe(userInput: string, db: { query: (s: string) => void }) {
  exec(\`ls \${userInput}\`);
  exec("rm " + userInput);
  spawn("sh", ["-c", userInput], { shell: true });
  db.query(\`SELECT * FROM users WHERE id = '\${userInput}'\`);
  db.query("SELECT * FROM users WHERE id = " + userInput);
  cors({ origin: "*" });
  https.request({ hostname: "example.com", rejectUnauthorized: false });
}
`;

describe("analyzeSource JS/TS", () => {
  test("flags dynamic exec/spawn, SQL, CORS, TLS", async () => {
    const findings = await analyzeSource(
      VULNERABLE_JS,
      "vulnerable.ts",
      "typescript",
    );
    const kinds = new Set(findings.map((f) => f.metadata?.kind));

    expect(kinds.has("shell")).toBe(true);
    expect(kinds.has("sql")).toBe(true);
    expect(kinds.has("cors")).toBe(true);
    expect(kinds.has("tls")).toBe(true);

    expect(
      findings.some(
        (f) => f.metadata?.kind === "shell" && f.severity === "critical",
      ),
    ).toBe(true);
    expect(
      findings.some((f) => f.title.includes("CORS") || f.metadata?.kind === "cors"),
    ).toBe(true);

    expect(
      findings.some((f) => f.evidence?.includes('exec("ls -la")')),
    ).toBe(false);
    expect(
      findings.some((f) => f.evidence?.includes("SELECT * FROM users WHERE id = $1")),
    ).toBe(false);

    for (const f of findings) {
      expect(f.detectorId).toBe("dangerous-sinks");
      expect(f.explanation.length).toBeGreaterThan(40);
      expect(f.fixPrompt.length).toBeGreaterThan(40);
      expect(f.line).toBeGreaterThan(0);
    }
  });

  test("flags eval and XSS in js-app known-bad", async () => {
    const content = await Bun.file(
      join(FIXTURES, "js-app/src/bad.ts"),
    ).text();
    const findings = await analyzeSource(content, "src/bad.ts", "typescript");
    const kinds = new Set(findings.map((f) => f.metadata?.kind));
    expect(kinds.has("shell")).toBe(true);
    expect(kinds.has("sql")).toBe(true);
    expect(kinds.has("cors")).toBe(true);
    expect(kinds.has("tls")).toBe(true);
    expect(kinds.has("code-exec")).toBe(true);
    expect(kinds.has("xss")).toBe(true);
  });

  test("js-app known-bad fixture produces shell/sql/cors/tls", async () => {
    const content = await Bun.file(
      join(FIXTURES, "js-app/src/bad.ts"),
    ).text();
    const findings = await analyzeSource(content, "src/bad.ts", "typescript");
    const kinds = new Set(findings.map((f) => f.metadata?.kind));
    expect(kinds.has("shell")).toBe(true);
    expect(kinds.has("sql")).toBe(true);
    expect(kinds.has("cors")).toBe(true);
    expect(kinds.has("tls")).toBe(true);
  });

  test("does not flag literal exec or parameterized query alone", async () => {
    const findings = await analyzeSource(
      `
import { exec, execFile, execFileSync, spawn } from "node:child_process";
exec("ls -la");
spawn("ls", ["-la"]);
execFile(toolPath, ["--version"]);
execFileSync(process.execPath, [scriptPath, "--check"]);
db.query("SELECT 1", []);
`,
      "safe.ts",
      "typescript",
    );
    expect(findings.filter((f) => f.metadata?.kind === "shell")).toHaveLength(0);
    expect(findings.filter((f) => f.metadata?.kind === "sql")).toHaveLength(0);
  });

  test("does not confuse RegExp.exec with child_process.exec", async () => {
    const findings = await analyzeSource(
      `
const re = /token/g;
const match = re.exec(userInput);
const used = new RegExp(source, "g");
used.exec(content);
`,
      "regex.ts",
      "typescript",
    );
    expect(findings.filter((f) => f.metadata?.kind === "shell")).toHaveLength(0);
  });

  test("flags only dynamic XSS and code-execution inputs", async () => {
    const dynamic = await analyzeSource(
      `
eval(userCode);
document.write(userHtml);
const view = <div dangerouslySetInnerHTML={{ __html: userHtml }} />;
`,
      "dynamic.tsx",
      "tsx",
    );
    expect(dynamic.some((f) => f.metadata?.kind === "code-exec")).toBe(true);
    expect(dynamic.filter((f) => f.metadata?.kind === "xss").length).toBe(2);

    const staticOnly = await analyzeSource(
      `
eval("2 + 2");
document.write("<p>Static</p>");
const view = <div dangerouslySetInnerHTML={{ __html: "<b>Static</b>" }} />;
`,
      "static.tsx",
      "tsx",
    );
    expect(
      staticOnly.filter(
        (f) => f.metadata?.kind === "code-exec" || f.metadata?.kind === "xss",
      ),
    ).toHaveLength(0);
  });
});

describe("analyzeSource Python", () => {
  test("flags os.system/subprocess shell, SQL f-string, verify=False", async () => {
    const content = await Bun.file(join(FIXTURES, "py-app/bad.py")).text();
    const findings = await analyzeSource(content, "bad.py", "python");
    const kinds = new Set(findings.map((f) => f.metadata?.kind));

    expect(kinds.has("shell")).toBe(true);
    expect(kinds.has("sql")).toBe(true);
    expect(kinds.has("tls")).toBe(true);

    expect(
      findings.some((f) => f.evidence?.includes("shell=False")),
    ).toBe(false);
    expect(
      findings.some((f) =>
        f.evidence?.includes('execute("SELECT * FROM users WHERE id = %s"'),
      ),
    ).toBe(false);
  });

  test("does not flag Python eval/exec of static literals", async () => {
    const findings = await analyzeSource(
      `
eval("2 + 2")
exec("x = 1")
compile("x = 1", "demo", "exec")
`,
      "static.py",
      "python",
    );
    expect(
      findings.filter((f) => f.metadata?.kind === "code-exec"),
    ).toHaveLength(0);
  });
});

describe("runDangerousSinksScan", () => {
  test("js-app project scan finds at least 4 sink kinds", async () => {
    const { findings } = await runDangerousSinksScan(join(FIXTURES, "js-app"));
    expect(findings.length).toBeGreaterThanOrEqual(4);
  });

  test("detector.run wires ScanContext", async () => {
    const detector = createDangerousSinksDetector();
    const { ctx } = createScanContext({
      rootDir: join(FIXTURES, "py-app"),
    });
    const findings = await detector.run(ctx);
    expect(findings.some((f) => f.severity === "critical")).toBe(true);
  });
});
