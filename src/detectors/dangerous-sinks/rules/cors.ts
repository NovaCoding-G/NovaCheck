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
      `CORS configurato in modo troppo permissivo (origine \`*\` o reflection di qualsiasi Origin). ` +
      `Qualsiasi sito può far fare al browser richieste autenticate verso la tua API e leggere le risposte, ` +
      `esponendo dati utente. Pattern frequente nel boilerplate generato dall'AI "per far funzionare il frontend".`,
    fixPrompt:
      `Restringi CORS a un allowlist esplicito di origini (es. https://app.example.com). ` +
      `Non usare origin: '*' né origin: true in produzione se usi cookie/Authorization. ` +
      `Allinea credentials e metodi a ciò che serve davvero.`,
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
          ? "CORS permette qualsiasi origine (*)"
          : "CORS riflette qualsiasi Origin (origin: true)",
        explanation,
        fixPrompt: `${fixPrompt} Occorrenza in ${file}:${lineOf(node)}.`,
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
            fixPrompt: `${fixPrompt} Occorrenza in ${file}:${lineOf(node)}.`,
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
          fixPrompt: `${fixPrompt} Occorrenza in ${file}:${lineOf(node)}.`,
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
