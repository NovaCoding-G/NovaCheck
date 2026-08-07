import type { Tree } from "web-tree-sitter";
import {
  colOf,
  isStarString,
  isTrueLiteral,
  jsCallArgs,
  jsCalleeName,
  lineOf,
  objectProp,
  snippet,
  walk,
} from "../ast-utils.ts";
import type { SinkMatch } from "../types.ts";

function explainCors(): { explanation: string; fixPrompt: string } {
  return {
    explanation:
      `CORS is configured too broadly (origin \`*\` or reflection of any Origin). ` +
      `Any website may be able to make authenticated browser requests to your API and read the responses, ` +
      `exposing user data.`,
    fixPrompt:
      `Restrict CORS to an explicit allowlist of origins (for example https://app.example.com). ` +
      `Do not use origin: '*' or origin: true in production with cookies or Authorization headers. ` +
      `Limit credentials and methods to what the application actually needs.`,
  };
}

export function findJsCorsSinks(tree: Tree, file: string): SinkMatch[] {
  const out: SinkMatch[] = [];
  const { explanation, fixPrompt } = explainCors();

  // cors({ origin: '*' }) / cors({ origin: true })
  for (const node of walk(tree.rootNode)) {
    if (node.type !== "call_expression") continue;
    if (jsCalleeName(node) !== "cors") continue;
    const args = jsCallArgs(node);
    const opts = args[0];
    if (!opts || opts.type !== "object") continue;

    const origin = objectProp(opts, "origin");
    if (!origin) continue;

    if (isStarString(origin) || isTrueLiteral(origin)) {
      out.push({
        kind: "cors",
        severity: "high",
        title: isStarString(origin)
          ? "CORS allows any origin (*)"
          : "CORS reflects any Origin (origin: true)",
        explanation,
        fixPrompt: `${fixPrompt} Occurrence at ${file}:${lineOf(node)}.`,
        file,
        line: lineOf(node),
        column: colOf(node),
        evidence: snippet(node.text),
        ruleId: isStarString(origin) ? "cors-star" : "cors-reflect",
      });
    }
  }

  // Access-Control-Allow-Origin: '*' as property or header call
  for (const node of walk(tree.rootNode)) {
    if (node.type === "pair") {
      const key = node.childForFieldName("key");
      const value = node.childForFieldName("value");
      const keyText = key?.text.replace(/^["']|["']$/g, "") ?? "";
      if (
        keyText === "Access-Control-Allow-Origin" ||
        keyText === "access-control-allow-origin"
      ) {
        if (isStarString(value ?? undefined)) {
          out.push({
            kind: "cors",
            severity: "high",
            title: "Header Access-Control-Allow-Origin: *",
            explanation,
            fixPrompt: `${fixPrompt} Occurrence at ${file}:${lineOf(node)}.`,
            file,
            line: lineOf(node),
            column: colOf(node),
            evidence: snippet(node.text),
            ruleId: "cors-header-star",
          });
        }
      }
    }

    if (node.type === "call_expression") {
      const name = jsCalleeName(node);
      if (name !== "setHeader" && name !== "header" && name !== "set") continue;
      const args = jsCallArgs(node);
      if (args.length < 2) continue;
      const headerName = args[0]?.text.replace(/^["'`]/, "").replace(/["'`]$/, "");
      if (
        headerName !== "Access-Control-Allow-Origin" &&
        headerName !== "access-control-allow-origin"
      ) {
        continue;
      }
      if (isStarString(args[1])) {
        out.push({
          kind: "cors",
          severity: "high",
          title: "Header Access-Control-Allow-Origin: *",
          explanation,
          fixPrompt: `${fixPrompt} Occurrence at ${file}:${lineOf(node)}.`,
          file,
          line: lineOf(node),
          column: colOf(node),
          evidence: snippet(node.text),
          ruleId: "cors-setheader-star",
        });
      }
    }
  }

  return out;
}
