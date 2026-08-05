import { readFile } from "node:fs/promises";
import type { Finding } from "../../types/index.ts";
import {
  listTextFiles,
  TEXT_FILE_DISCOVERY_PATTERNS,
  toRel,
} from "../secrets/walk.ts";
import { langForFile, parseSource } from "./parser.ts";
import { findJsCorsSinks } from "./rules/cors.ts";
import { findJsCodeExecSinks, findPyCodeExecSinks } from "./rules/code-exec.ts";
import {
  findJsDeserializationSinks,
  findPyDeserializationSinks,
} from "./rules/deserialization.ts";
import { findJsShellSinks, findPyShellSinks } from "./rules/shell.ts";
import { findJsSqlSinks, findPySqlSinks } from "./rules/sql.ts";
import { findJsTlsSinks, findPyTlsSinks } from "./rules/tls.ts";
import { findJsXssSinks } from "./rules/xss.ts";
import type { SinkMatch } from "./types.ts";

export const DANGEROUS_SINKS_DISCOVERY_PATTERNS = [
  ...TEXT_FILE_DISCOVERY_PATTERNS,
  "language filter: .js .mjs .cjs .jsx .ts .tsx .py",
  "engine: tree-sitter AST (javascript / typescript / tsx / python)",
] as const;

export interface DangerousSinksScanResult {
  findings: Finding[];
  filesReceived: number;
  filesAnalyzed: number;
  files: string[];
  discoveryPatterns: string[];
}

function toFinding(m: SinkMatch): Finding {
  return {
    id: `dangerous-sinks:${m.ruleId}:${m.file}:${m.line}:${m.column}`,
    detectorId: "dangerous-sinks",
    severity: m.severity,
    title: m.title,
    explanation: m.explanation,
    fixPrompt: m.fixPrompt,
    file: m.file,
    line: m.line,
    column: m.column,
    evidence: m.evidence,
    metadata: {
      kind: m.kind,
      ruleId: m.ruleId,
      engine: "tree-sitter",
    },
  };
}

export async function analyzeSource(
  content: string,
  relFile: string,
  langId: NonNullable<ReturnType<typeof langForFile>>,
): Promise<Finding[]> {
  const tree = await parseSource(content, langId);
  if (!tree) return [];

  try {
    const matches: SinkMatch[] = [];
    if (langId === "python") {
      matches.push(
        ...findPyShellSinks(tree, relFile),
        ...findPySqlSinks(tree, relFile),
        ...findPyTlsSinks(tree, relFile),
        ...findPyCodeExecSinks(tree, relFile),
        ...findPyDeserializationSinks(tree, relFile),
      );
    } else {
      matches.push(
        ...findJsShellSinks(tree, relFile),
        ...findJsSqlSinks(tree, relFile),
        ...findJsCorsSinks(tree, relFile),
        ...findJsTlsSinks(tree, relFile),
        ...findJsCodeExecSinks(tree, relFile),
        ...findJsXssSinks(tree, relFile),
        ...findJsDeserializationSinks(tree, relFile),
      );
    }
    return matches.map(toFinding);
  } finally {
    tree.delete();
  }
}

export async function runDangerousSinksScan(
  rootDir: string,
): Promise<DangerousSinksScanResult> {
  const files = await listTextFiles(rootDir);
  const findings: Finding[] = [];
  let filesAnalyzed = 0;
  const analyzedPaths: string[] = [];

  for (const abs of files) {
    const lang = langForFile(abs);
    if (!lang) continue;
    const rel = toRel(rootDir, abs);
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    try {
      findings.push(...(await analyzeSource(content, rel, lang)));
      filesAnalyzed++;
      analyzedPaths.push(abs);
    } catch {
      // Parse failures: skip file (precision — don't invent findings)
    }
  }

  return {
    findings,
    filesReceived: files.length,
    filesAnalyzed,
    files: analyzedPaths,
    discoveryPatterns: [...DANGEROUS_SINKS_DISCOVERY_PATTERNS],
  };
}
