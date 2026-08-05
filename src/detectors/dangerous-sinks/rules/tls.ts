import type { Tree } from "web-tree-sitter";
import {
  colOf,
  isFalseLiteral,
  lineOf,
  pyKwarg,
  snippet,
  walk,
} from "../ast-utils.ts";
import type { SinkMatch } from "../types.ts";

function explainTls(): { explanation: string; fixPrompt: string } {
  return {
    explanation:
      `Verifica del certificato TLS disattivata. La connessione è vulnerabile a man-in-the-middle: ` +
      `un attaccante sulla rete può intercettare o alterare traffico (token, password, dati). ` +
      `Spesso l'AI lo inserisce per "sistemare" errori SSL in sviluppo e poi resta in produzione.`,
    fixPrompt:
      `Riabilita la verifica TLS (rimuovi rejectUnauthorized: false / verify=False). ` +
      `Se usi un certificato self-signed in dev, configura una CA di fiducia locale invece di disattivare i check. ` +
      `Non impostare NODE_TLS_REJECT_UNAUTHORIZED=0.`,
  };
}

export function findJsTlsSinks(tree: Tree, file: string): SinkMatch[] {
  const out: SinkMatch[] = [];
  const { explanation, fixPrompt } = explainTls();

  for (const node of walk(tree.rootNode)) {
    if (node.type === "pair") {
      const key = node.childForFieldName("key");
      const value = node.childForFieldName("value");
      if (key?.text === "rejectUnauthorized" && isFalseLiteral(value ?? undefined)) {
        out.push({
          kind: "tls",
          severity: "critical",
          title: "TLS: rejectUnauthorized: false",
          explanation,
          fixPrompt: `${fixPrompt} Occorrenza in ${file}:${lineOf(node)}.`,
          file,
          line: lineOf(node),
          column: colOf(node),
          evidence: snippet(node.text),
          ruleId: "tls-reject-unauthorized-false",
        });
      }
    }

    // process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    if (node.type === "assignment_expression") {
      const left = node.childForFieldName("left");
      const right = node.childForFieldName("right");
      if (
        left?.text.includes("NODE_TLS_REJECT_UNAUTHORIZED") &&
        (right?.text.includes("0") || right?.text.includes('"0"') || right?.text.includes("'0'"))
      ) {
        out.push({
          kind: "tls",
          severity: "critical",
          title: "TLS: NODE_TLS_REJECT_UNAUTHORIZED disabilitato",
          explanation,
          fixPrompt: `${fixPrompt} Occorrenza in ${file}:${lineOf(node)}.`,
          file,
          line: lineOf(node),
          column: colOf(node),
          evidence: snippet(node.text),
          ruleId: "tls-env-reject-unauthorized",
        });
      }
    }

  }

  return out;
}

export function findPyTlsSinks(tree: Tree, file: string): SinkMatch[] {
  const out: SinkMatch[] = [];
  const { explanation, fixPrompt } = explainTls();

  for (const node of walk(tree.rootNode)) {
    if (node.type !== "call") continue;

    const verify = pyKwarg(node, "verify");
    if (verify?.text === "False") {
      out.push({
        kind: "tls",
        severity: "critical",
        title: "TLS: verify=False",
        explanation,
        fixPrompt: `${fixPrompt} Occorrenza in ${file}:${lineOf(node)}.`,
        file,
        line: lineOf(node),
        column: colOf(node),
        evidence: snippet(node.text),
        ruleId: "tls-py-verify-false",
      });
    }

    // ssl=False (mysql connectors etc.)
    const ssl = pyKwarg(node, "ssl");
    if (ssl?.text === "False") {
      out.push({
        kind: "tls",
        severity: "high",
        title: "TLS: ssl=False",
        explanation,
        fixPrompt: `${fixPrompt} Occorrenza in ${file}:${lineOf(node)}.`,
        file,
        line: lineOf(node),
        column: colOf(node),
        evidence: snippet(node.text),
        ruleId: "tls-py-ssl-false",
      });
    }

    // ssl.CERT_NONE
    for (const child of walk(node)) {
      if (child.type === "attribute" && child.text.endsWith("CERT_NONE")) {
        out.push({
          kind: "tls",
          severity: "critical",
          title: "TLS: ssl.CERT_NONE",
          explanation,
          fixPrompt: `${fixPrompt} Occorrenza in ${file}:${lineOf(child)}.`,
          file,
          line: lineOf(child),
          column: colOf(child),
          evidence: snippet(child.text),
          ruleId: "tls-py-cert-none",
        });
      }
    }
  }

  return out;
}
