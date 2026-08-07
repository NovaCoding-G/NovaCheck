import type { Tree } from "web-tree-sitter";
import {
  colOf,
  jsCallArgs,
  jsCalleeName,
  jsCalleeText,
  jsStringIsDynamic,
  lineOf,
  pyCalleeName,
  pyCallArgs,
  pyStringIsDynamic,
  snippet,
  walk,
} from "../ast-utils.ts";
import type { SinkMatch } from "../types.ts";

const JS_EXEC = new Set(["eval", "Function"]);
const JS_VM = new Set([
  "runInThisContext",
  "runInNewContext",
  "runInContext",
  "compileFunction",
]);

function explainExec(): { explanation: string; fixPrompt: string } {
  return {
    explanation:
      `Dynamic code execution through eval, Function, or vm. ` +
      `If the input is not fully controlled, an attacker can execute arbitrary code in the process (RCE).`,
    fixPrompt:
      `Remove eval, new Function, and vm.runIn*. Use JSON parsers, ASTs, or dedicated libraries. ` +
      `Never execute strings received from users, files, or the network.`,
  };
}

export function findJsCodeExecSinks(tree: Tree, file: string): SinkMatch[] {
  const out: SinkMatch[] = [];
  const { explanation, fixPrompt } = explainExec();

  for (const node of walk(tree.rootNode)) {
    if (node.type !== "call_expression" && node.type !== "new_expression") {
      continue;
    }
    const name = jsCalleeName(node);
    if (!name) continue;

    if (JS_EXEC.has(name) || JS_VM.has(name)) {
      const args = jsCallArgs(node);
      const first = args[0];
      if (first && jsStringIsDynamic(first)) {
        out.push({
          kind: "code-exec",
          severity: "critical",
          title: `Code execution risk: ${jsCalleeText(node)}`,
          explanation,
          fixPrompt: `${fixPrompt} Occurrence at ${file}:${lineOf(node)}.`,
          file,
          line: lineOf(node),
          column: colOf(node),
          evidence: snippet(node.text),
          ruleId: `code-exec-js-${name}`,
        });
      }
    }
  }
  return out;
}

export function findPyCodeExecSinks(tree: Tree, file: string): SinkMatch[] {
  const out: SinkMatch[] = [];
  const { explanation, fixPrompt } = explainExec();
  const risky = new Set(["eval", "exec", "compile"]);

  for (const node of walk(tree.rootNode)) {
    if (node.type !== "call") continue;
    const name = pyCalleeName(node);
    if (!name || !risky.has(name)) continue;
    const args = pyCallArgs(node);
    const first = args[0];
    if (!first || !pyStringIsDynamic(first)) continue;
    out.push({
      kind: "code-exec",
      severity: "critical",
      title: `Code execution risk: ${name}`,
      explanation,
      fixPrompt: `${fixPrompt} Occurrence at ${file}:${lineOf(node)}.`,
      file,
      line: lineOf(node),
      column: colOf(node),
      evidence: snippet(node.text),
      ruleId: `code-exec-py-${name}`,
    });
  }
  return out;
}
