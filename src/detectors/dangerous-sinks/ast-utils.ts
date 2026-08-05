import type { Node } from "web-tree-sitter";

/** Walk all named descendants (DFS). */
export function* walk(node: Node): Generator<Node> {
  yield node;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) yield* walk(child);
  }
}

export function lineOf(node: Node): number {
  return node.startPosition.row + 1;
}

export function colOf(node: Node): number {
  return node.startPosition.column + 1;
}

/** Truncate evidence for display. */
export function snippet(text: string, max = 80): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** True if template_string / string has interpolation / concatenation risk. */
export function jsStringIsDynamic(node: Node): boolean {
  if (node.type === "template_string") {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i)?.type === "template_substitution") return true;
    }
    return false;
  }
  if (node.type === "binary_expression") {
    // "a" + x  or  x + "a"
    return true;
  }
  if (node.type === "identifier" || node.type === "member_expression") {
    return true;
  }
  if (node.type === "call_expression") {
    // String(...), something.toString() — treat as dynamic
    return true;
  }
  return false;
}

/** Collect string-ish literal pieces from a node (for SQL keyword checks). */
export function collectJsStringLiterals(node: Node): string[] {
  const out: string[] = [];
  if (node.type === "string" || node.type === "string_fragment") {
    out.push(node.text.replace(/^["'`]|["'`]$/g, ""));
    return out;
  }
  if (node.type === "template_string") {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (!c) continue;
      if (c.type === "string_fragment") out.push(c.text);
    }
    return out;
  }
  if (node.type === "binary_expression") {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) out.push(...collectJsStringLiterals(c));
    }
  }
  return out;
}

export function looksLikeSql(fragments: string[]): boolean {
  const joined = fragments.join(" ");
  return /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE|MERGE)\b/i.test(joined);
}

/** Callee bare name: exec / query / spawn … */
export function jsCalleeName(call: Node): string | undefined {
  const fn = call.childForFieldName("function");
  if (!fn) return undefined;
  if (fn.type === "identifier") return fn.text;
  if (fn.type === "member_expression") {
    const prop = fn.childForFieldName("property");
    return prop?.text;
  }
  return undefined;
}

/** Full callee text for evidence (child_process.exec). */
export function jsCalleeText(call: Node): string {
  return call.childForFieldName("function")?.text ?? call.text.slice(0, 40);
}

export function jsCallArgs(call: Node): Node[] {
  const args = call.childForFieldName("arguments");
  if (!args) return [];
  const out: Node[] = [];
  for (let i = 0; i < args.namedChildCount; i++) {
    const c = args.namedChild(i);
    if (c) out.push(c);
  }
  return out;
}

/** Find object property value by key name in an object literal. */
export function objectProp(obj: Node, key: string): Node | undefined {
  if (obj.type !== "object") return undefined;
  for (let i = 0; i < obj.namedChildCount; i++) {
    const pair = obj.namedChild(i);
    if (!pair || pair.type !== "pair") continue;
    const k = pair.childForFieldName("key");
    if (k?.text === key) return pair.childForFieldName("value") ?? undefined;
  }
  return undefined;
}

export function isFalseLiteral(node: Node | undefined): boolean {
  return node?.type === "false" || node?.text === "false";
}

export function isTrueLiteral(node: Node | undefined): boolean {
  return node?.type === "true" || node?.text === "true";
}

export function isStarString(node: Node | undefined): boolean {
  if (!node) return false;
  if (node.type !== "string" && node.type !== "template_string") return false;
  const t = node.text.replace(/^["'`]/, "").replace(/["'`]$/, "");
  return t === "*";
}

/** Python: f-string or concatenated / formatted string. */
export function pyStringIsDynamic(node: Node): boolean {
  if (node.type === "string" && node.text.startsWith("f")) return true;
  if (node.type === "concatenated_string") {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (pyStringIsDynamic(node.namedChild(i)!)) return true;
    }
  }
  if (node.type === "binary_operator" && node.text.includes("+")) return true;
  if (node.type === "call") {
    // "...".format(...)
    const fn = node.childForFieldName("function");
    if (fn?.type === "attribute" && fn.text.endsWith(".format")) return true;
  }
  if (node.type === "identifier" || node.type === "attribute") return true;
  // "x % y" modulo formatting (dynamic if either side isn't a plain literal-only form)
  if (node.type === "binary_operator" && node.text.includes("%")) {
    return true;
  }
  return false;
}

export function collectPyStringLiterals(node: Node): string[] {
  const out: string[] = [];
  if (node.type === "string") {
    out.push(node.text.replace(/^f?["']|["']$/g, "").replace(/^f?"""|"""$/g, ""));
    return out;
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) out.push(...collectPyStringLiterals(c));
  }
  return out;
}

export function pyCalleeName(call: Node): string | undefined {
  const fn = call.childForFieldName("function");
  if (!fn) return undefined;
  if (fn.type === "identifier") return fn.text;
  if (fn.type === "attribute") {
    const attr = fn.childForFieldName("attribute");
    return attr?.text ?? fn.text.split(".").pop();
  }
  return undefined;
}

export function pyCallArgs(call: Node): Node[] {
  const args = call.childForFieldName("arguments");
  if (!args) return [];
  const out: Node[] = [];
  for (let i = 0; i < args.namedChildCount; i++) {
    const c = args.namedChild(i);
    if (c && c.type !== "keyword_argument") out.push(c);
  }
  return out;
}

export function pyKwarg(call: Node, name: string): Node | undefined {
  const args = call.childForFieldName("arguments");
  if (!args) return undefined;
  for (let i = 0; i < args.namedChildCount; i++) {
    const c = args.namedChild(i);
    if (c?.type !== "keyword_argument") continue;
    const n = c.childForFieldName("name");
    if (n?.text === name) return c.childForFieldName("value") ?? undefined;
  }
  return undefined;
}
