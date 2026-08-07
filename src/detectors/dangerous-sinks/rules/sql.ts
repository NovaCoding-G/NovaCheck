import type { Tree } from "web-tree-sitter";
import {
  colOf,
  collectJsStringLiterals,
  collectPyStringLiterals,
  jsCallArgs,
  jsCalleeName,
  jsCalleeText,
  jsStringIsDynamic,
  lineOf,
  looksLikeSql,
  pyCallArgs,
  pyCalleeName,
  pyStringIsDynamic,
  snippet,
  walk,
} from "../ast-utils.ts";
import type { SinkMatch } from "../types.ts";

/** Methods that take raw SQL — high-signal only. */
const JS_SQL_FNS = new Set([
  "query",
  "querySync",
  "execute",
  "executeSync",
  "raw",
  "$queryRawUnsafe",
  "$executeRawUnsafe",
  "sequelize", // rare as bare
]);

const PY_SQL_FNS = new Set(["execute", "executemany", "executescript"]);

function explainSql(): { explanation: string; fixPrompt: string } {
  return {
    explanation:
      `SQL query built through concatenation or interpolation. ` +
      `Unsanitized input can modify the query (SQL injection), enabling data access or modification, ` +
      `authentication bypass, or worse.`,
    fixPrompt:
      `Rewrite the query with bound parameters (placeholders such as $1, ?, or :name) and pass values separately. ` +
      `Avoid f-strings, interpolated template literals, and string concatenation in SQL. ` +
      `With Prisma, use $queryRaw with Prisma.sql fragments and never pass user input to $queryRawUnsafe.`,
  };
}

export function findJsSqlSinks(tree: Tree, file: string): SinkMatch[] {
  const out: SinkMatch[] = [];
  const { explanation, fixPrompt } = explainSql();

  for (const node of walk(tree.rootNode)) {
    if (node.type !== "call_expression") continue;
    const name = jsCalleeName(node);
    if (!name) continue;

    const unsafePrisma =
      name === "$queryRawUnsafe" || name === "$executeRawUnsafe";
    if (!unsafePrisma && !JS_SQL_FNS.has(name)) continue;

    // Safe Prisma tagged templates: $queryRaw`...` — skip unless Unsafe
    if (
      (name === "$queryRaw" || name === "$executeRaw") &&
      !unsafePrisma
    ) {
      continue;
    }

    const args = jsCallArgs(node);
    const sqlArg = args[0];
    if (!sqlArg) continue;

    // Tagged template call: arguments may be the template_string itself
    const sqlNode =
      sqlArg.type === "template_string" ||
      sqlArg.type === "string" ||
      sqlArg.type === "binary_expression"
        ? sqlArg
        : sqlArg;

    if (!jsStringIsDynamic(sqlNode) && !unsafePrisma) continue;

    const fragments = collectJsStringLiterals(sqlNode);
    if (!unsafePrisma && !looksLikeSql(fragments) && name !== "raw") continue;
    // For .raw() require SQL-looking or dynamic with SQL keyword in callee context
    if (name === "raw" && !looksLikeSql(fragments) && !jsStringIsDynamic(sqlNode)) {
      continue;
    }
    if (name === "raw" && !looksLikeSql(fragments)) continue;

    // query/execute: require SQL-looking fragments when dynamic
    if (
      !unsafePrisma &&
      (name === "query" || name === "execute" || name === "querySync") &&
      !looksLikeSql(fragments)
    ) {
      continue;
    }

    out.push({
      kind: "sql",
      severity: "critical",
      title: `SQL injection risk: ${jsCalleeText(node)}`,
      explanation,
      fixPrompt: `${fixPrompt} Occurrence at ${file}:${lineOf(node)}.`,
      file,
      line: lineOf(node),
      column: colOf(node),
      evidence: snippet(node.text),
      ruleId: unsafePrisma ? "sql-js-prisma-unsafe" : "sql-js-dynamic-query",
    });
  }

  return out;
}

export function findPySqlSinks(tree: Tree, file: string): SinkMatch[] {
  const out: SinkMatch[] = [];
  const { explanation, fixPrompt } = explainSql();

  for (const node of walk(tree.rootNode)) {
    if (node.type !== "call") continue;
    const name = pyCalleeName(node);
    if (!name || !PY_SQL_FNS.has(name)) continue;

    const args = pyCallArgs(node);
    const sqlArg = args[0];
    if (!sqlArg || !pyStringIsDynamic(sqlArg)) continue;

    const fragments = collectPyStringLiterals(sqlArg);
    if (!looksLikeSql(fragments)) continue;

    // cursor.execute("...%s", (x,)) is safe — second arg present with tuple
    // But execute(f"...{x}") has only one arg and is unsafe
    // execute("..." % x) is dynamic binary — unsafe
    // execute("... %s" % (x,)) — still flagged as dynamic; precision: if second positional arg exists and sql is NOT f-string/concat, skip
    const second = args[1];
    if (
      second &&
      sqlArg.type === "string" &&
      !sqlArg.text.startsWith("f") &&
      !sqlArg.text.includes("{")
    ) {
      // Parameterized style with separate params
      continue;
    }

    out.push({
      kind: "sql",
      severity: "critical",
      title: `SQL injection risk: ${name}`,
      explanation,
      fixPrompt: `${fixPrompt} Occurrence at ${file}:${lineOf(node)}.`,
      file,
      line: lineOf(node),
      column: colOf(node),
      evidence: snippet(node.text),
      ruleId: "sql-py-dynamic-query",
    });
  }

  return out;
}
