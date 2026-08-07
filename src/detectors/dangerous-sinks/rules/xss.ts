import type { Tree } from "web-tree-sitter";
import {
  colOf,
  jsCallArgs,
  jsCalleeName,
  jsCalleeText,
  jsStringIsDynamic,
  lineOf,
  snippet,
  walk,
} from "../ast-utils.ts";
import type { SinkMatch } from "../types.ts";

function explainXss(): { explanation: string; fixPrompt: string } {
  return {
    explanation:
      `XSS sink: HTML or script is injected into the DOM without sanitization. ` +
      `User input could execute JavaScript in a victim's browser, enabling session theft or page defacement.`,
    fixPrompt:
      `Avoid innerHTML, document.write, and dangerouslySetInnerHTML with untrusted data. ` +
      `Use textContent, DOM-created elements, or a sanitizer such as DOMPurify. In React, prefer native JSX escaping.`,
  };
}

export function findJsXssSinks(tree: Tree, file: string): SinkMatch[] {
  const out: SinkMatch[] = [];
  const { explanation, fixPrompt } = explainXss();

  for (const node of walk(tree.rootNode)) {
    // assignment: el.innerHTML = ...
    if (node.type === "assignment_expression") {
      const left = node.childForFieldName("left");
      const right = node.childForFieldName("right");
      if (
        left &&
        (left.text.endsWith(".innerHTML") ||
          left.text.endsWith(".outerHTML") ||
          left.text.includes(".innerHTML"))
      ) {
        if (right && (jsStringIsDynamic(right) || right.type !== "string")) {
          out.push({
            kind: "xss",
            severity: "high",
            title: "XSS risk: innerHTML/outerHTML assignment",
            explanation,
            fixPrompt: `${fixPrompt} Occurrence at ${file}:${lineOf(node)}.`,
            file,
            line: lineOf(node),
            column: colOf(node),
            evidence: snippet(node.text),
            ruleId: "xss-innerhtml-assign",
          });
        }
      }
    }

    if (node.type === "call_expression") {
      const name = jsCalleeName(node);
      const full = jsCalleeText(node);
      if (name === "write" && full.includes("document.write")) {
        const value = jsCallArgs(node)[0];
        if (value && jsStringIsDynamic(value)) {
          out.push({
            kind: "xss",
            severity: "high",
            title: "XSS risk: document.write",
            explanation,
            fixPrompt: `${fixPrompt} Occurrence at ${file}:${lineOf(node)}.`,
            file,
            line: lineOf(node),
            column: colOf(node),
            evidence: snippet(node.text),
            ruleId: "xss-document-write",
          });
        }
      }
      if (name === "writeln" && full.includes("document.writeln")) {
        const value = jsCallArgs(node)[0];
        if (value && jsStringIsDynamic(value)) {
          out.push({
            kind: "xss",
            severity: "high",
            title: "XSS risk: document.writeln",
            explanation,
            fixPrompt: `${fixPrompt} Occurrence at ${file}:${lineOf(node)}.`,
            file,
            line: lineOf(node),
            column: colOf(node),
            evidence: snippet(node.text),
            ruleId: "xss-document-writeln",
          });
        }
      }
    }

    // JSX: dangerouslySetInnerHTML={{ __html: ... }}
    if (node.type === "jsx_attribute") {
      if (
        node.text.startsWith("dangerouslySetInnerHTML") &&
        dangerouslySetInnerHtmlIsDynamic(node.text)
      ) {
        out.push({
          kind: "xss",
          severity: "high",
          title: "XSS risk: dangerouslySetInnerHTML",
          explanation,
          fixPrompt: `${fixPrompt} Occurrence at ${file}:${lineOf(node)}.`,
          file,
          line: lineOf(node),
          column: colOf(node),
          evidence: snippet(node.parent?.text ?? node.text),
          ruleId: "xss-dangerously-set-inner-html",
        });
      }
    }
  }

  return out;
}

function dangerouslySetInnerHtmlIsDynamic(attribute: string): boolean {
  const value = attribute.match(/__html\s*:\s*([\s\S]+?)\s*\}\s*\}/)?.[1];
  if (!value) return true;
  const trimmed = value.trim();
  if (
    /^"(?:[^"\\]|\\.)*"$/.test(trimmed) ||
    /^'(?:[^'\\]|\\.)*'$/.test(trimmed) ||
    /^`(?:[^`\\]|\\.)*`$/.test(trimmed)
  ) {
    return false;
  }
  return true;
}
