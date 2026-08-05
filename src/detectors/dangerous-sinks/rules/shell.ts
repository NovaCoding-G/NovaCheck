import type { Node, Tree } from "web-tree-sitter";
import {
  colOf,
  jsCallArgs,
  jsCalleeName,
  jsCalleeText,
  jsStringIsDynamic,
  lineOf,
  objectProp,
  pyCallArgs,
  pyCalleeName,
  pyKwarg,
  pyStringIsDynamic,
  snippet,
  walk,
  isTrueLiteral,
} from "../ast-utils.ts";
import type { SinkMatch } from "../types.ts";

const JS_SHELL_FNS = new Set([
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "spawn",
  "spawnSync",
]);

function explainShell(lang: string): { explanation: string; fixPrompt: string } {
  return {
    explanation:
      `Comando shell costruito con input dinamico (${lang}). ` +
      `Se parte del comando viene da richiesta utente o da dati non fidati, un attaccante può iniettare ` +
      `metacaratteri shell (\`;\`, \`&&\`, \`|\`) ed eseguire codice arbitrario sul server. ` +
      `È un pattern tipico del codice generato dall'AI che "fa funzionare" la feature senza sanitizzare.`,
    fixPrompt:
      `Rimuovi l'interpolazione/concatenazione nel comando shell. Usa un'API con argomenti separati ` +
      `(spawn/execFile con array di args, senza shell:true; in Python subprocess.run([...], shell=False)). ` +
      `Valida e allowlist-a ogni input utente. Non passare mai stringhe di comando costruite a runtime.`,
  };
}

function nodeHasDynamic(node: Node): boolean {
  if (jsStringIsDynamic(node)) return true;
  if (node.type === "array") {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c && nodeHasDynamic(c)) return true;
    }
  }
  return false;
}

export function findJsShellSinks(tree: Tree, file: string): SinkMatch[] {
  const out: SinkMatch[] = [];
  const { explanation, fixPrompt } = explainShell("JS/TS");
  const bindings = collectChildProcessBindings(tree.rootNode.text);

  for (const node of walk(tree.rootNode)) {
    if (node.type !== "call_expression") continue;
    const name = jsCalleeName(node);
    if (!name || !JS_SHELL_FNS.has(name)) continue;
    if (!isChildProcessCall(jsCalleeText(node), bindings)) continue;

    const args = jsCallArgs(node);
    const cmd = args[0];
    if (!cmd) continue;

    const opts = args.find((a) => a.type === "object");
    const shellTrue = opts
      ? isTrueLiteral(objectProp(opts, "shell") ?? undefined)
      : false;

    const isExecFamily = name === "exec" || name === "execSync";
    const dynamicCmd = jsStringIsDynamic(cmd);
    const dynamicSomewhere = args.some((a) => a.type !== "object" && nodeHasDynamic(a));

    let risky = false;
    if (isExecFamily && dynamicCmd) {
      risky = true;
    } else if (shellTrue && dynamicSomewhere) {
      // spawn/execFile(..., { shell: true }) with dynamic pieces
      risky = true;
    } else if (
      !shellTrue &&
      dynamicCmd &&
      (name === "execFile" || name === "execFileSync") &&
      cmd.type !== "array"
    ) {
      // execFile(dynamicString) without arg array — often shell-like
      risky = true;
    }

    if (!risky) continue;

    out.push({
      kind: "shell",
      severity: "critical",
      title: `Shell injection risk: ${jsCalleeText(node)}`,
      explanation,
      fixPrompt: `${fixPrompt} Occorrenza in ${file}:${lineOf(node)}.`,
      file,
      line: lineOf(node),
      column: colOf(node),
      evidence: snippet(node.text),
      ruleId: "shell-js-dynamic-command",
    });
  }

  return out;
}

interface ChildProcessBindings {
  direct: Set<string>;
  namespaces: Set<string>;
}

function collectChildProcessBindings(source: string): ChildProcessBindings {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  const modulePattern = String.raw`["'](?:node:)?child_process["']`;

  const namedPatterns = [
    new RegExp(
      String.raw`import\s*\{([^}]+)\}\s*from\s*${modulePattern}`,
      "g",
    ),
    new RegExp(
      String.raw`(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*${modulePattern}\s*\)`,
      "g",
    ),
  ];
  for (const pattern of namedPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      for (const item of (match[1] ?? "").split(",")) {
        const parts = item.trim().split(/\s+(?:as|:)\s+/);
        const imported = parts[0]?.trim();
        const local = (parts[1] ?? imported)?.trim();
        if (imported && local && JS_SHELL_FNS.has(imported)) direct.add(local);
      }
    }
  }

  const namespacePatterns = [
    new RegExp(
      String.raw`import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s+${modulePattern}`,
      "g",
    ),
    new RegExp(
      String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*${modulePattern}\s*\)`,
      "g",
    ),
  ];
  for (const pattern of namespacePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) namespaces.add(match[1]);
    }
  }
  return { direct, namespaces };
}

function isChildProcessCall(
  callee: string,
  bindings: ChildProcessBindings,
): boolean {
  if (!callee.includes(".")) return bindings.direct.has(callee);
  const owner = callee.split(".")[0] ?? "";
  return (
    bindings.namespaces.has(owner) ||
    /^require\(\s*["'](?:node:)?child_process["']\s*\)\./.test(callee)
  );
}

export function findPyShellSinks(tree: Tree, file: string): SinkMatch[] {
  const out: SinkMatch[] = [];
  const { explanation, fixPrompt } = explainShell("Python");

  for (const node of walk(tree.rootNode)) {
    if (node.type !== "call") continue;
    const name = pyCalleeName(node);
    if (!name) continue;

    const args = pyCallArgs(node);
    const cmd = args[0];
    const shellKw = pyKwarg(node, "shell");
    const shellTrue = shellKw?.text === "True";

    if (name === "system") {
      if (!cmd || !pyStringIsDynamic(cmd)) continue;
      out.push(pyHit(node, file, explanation, fixPrompt));
      continue;
    }

    if (
      name === "run" ||
      name === "call" ||
      name === "Popen" ||
      name === "check_output" ||
      name === "check_call" ||
      name === "getoutput" ||
      name === "getstatusoutput"
    ) {
      if (!shellTrue) continue;
      if (!cmd || !pyStringIsDynamic(cmd)) continue;
      out.push(pyHit(node, file, explanation, fixPrompt));
    }
  }

  return out;
}

function pyHit(
  node: Node,
  file: string,
  explanation: string,
  fixPrompt: string,
): SinkMatch {
  return {
    kind: "shell",
    severity: "critical",
    title: `Shell injection risk: ${pyCalleeName(node) ?? "subprocess"}`,
    explanation,
    fixPrompt: `${fixPrompt} Occorrenza in ${file}:${lineOf(node)}.`,
    file,
    line: lineOf(node),
    column: colOf(node),
    evidence: snippet(node.text),
    ruleId: "shell-py-dynamic-command",
  };
}
