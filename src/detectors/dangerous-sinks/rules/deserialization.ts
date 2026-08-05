import type { Tree } from "web-tree-sitter";
import {
  colOf,
  jsCalleeName,
  jsCalleeText,
  lineOf,
  pyCalleeName,
  snippet,
  walk,
} from "../ast-utils.ts";
import type { SinkMatch } from "../types.ts";

function explain(): { explanation: string; fixPrompt: string } {
  return {
    explanation:
      `Deserializzazione non sicura di dati potenzialmente controllati da un attaccante. ` +
      `Può portare a RCE (pickle, yaml.load unsafe, unserialize). Pattern frequente in codice AI "veloce".`,
    fixPrompt:
      `In Python usa yaml.safe_load / json; evita pickle su dati non fidati. ` +
      `In JS evita deserializzare oggetti arbitrari; valida lo schema (zod/io-ts).`,
  };
}

export function findPyDeserializationSinks(tree: Tree, file: string): SinkMatch[] {
  const out: SinkMatch[] = [];
  const { explanation, fixPrompt } = explain();

  for (const node of walk(tree.rootNode)) {
    if (node.type !== "call") continue;
    const name = pyCalleeName(node);
    const full = node.childForFieldName("function")?.text ?? name ?? "";
    if (name === "loads" && full.includes("pickle")) {
      out.push(hit(node, file, "pickle.loads", explanation, fixPrompt));
    }
    if (name === "load" && full.includes("pickle")) {
      out.push(hit(node, file, "pickle.load", explanation, fixPrompt));
    }
    // yaml.load(...) without SafeLoader — flag bare yaml.load
    if (name === "load" && (full === "yaml.load" || full.endsWith(".load"))) {
      if (full.includes("yaml")) {
        out.push(hit(node, file, "yaml.load", explanation, fixPrompt, "high"));
      }
    }
  }
  return out;
}

export function findJsDeserializationSinks(tree: Tree, file: string): SinkMatch[] {
  const out: SinkMatch[] = [];
  const { explanation, fixPrompt } = explain();
  for (const node of walk(tree.rootNode)) {
    if (node.type !== "call_expression") continue;
    const name = jsCalleeName(node);
    const full = jsCalleeText(node);
    // node-serialize / unserialize patterns
    if (name === "unserialize" || full.includes("node-serialize")) {
      out.push({
        kind: "deserialization",
        severity: "critical",
        title: `Unsafe deserialization: ${full}`,
        explanation,
        fixPrompt: `${fixPrompt} Occorrenza in ${file}:${lineOf(node)}.`,
        file,
        line: lineOf(node),
        column: colOf(node),
        evidence: snippet(node.text),
        ruleId: "deser-js-unserialize",
      });
    }
  }
  return out;
}

function hit(
  node: import("web-tree-sitter").Node,
  file: string,
  label: string,
  explanation: string,
  fixPrompt: string,
  severity: SinkMatch["severity"] = "critical",
): SinkMatch {
  return {
    kind: "deserialization",
    severity,
    title: `Unsafe deserialization: ${label}`,
    explanation,
    fixPrompt: `${fixPrompt} Occorrenza in ${file}:${lineOf(node)}.`,
    file,
    line: lineOf(node),
    column: colOf(node),
    evidence: snippet(node.text),
    ruleId: `deser-${label.replaceAll(".", "-")}`,
  };
}
