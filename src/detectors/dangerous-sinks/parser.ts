import { fileURLToPath } from "node:url";
import { Language, Parser, type Tree } from "web-tree-sitter";

export type LangId = "javascript" | "typescript" | "tsx" | "python";

const WASM: Record<LangId, string> = {
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
};

let initPromise: Promise<void> | undefined;
const languages = new Map<LangId, Language>();

export async function initTreeSitter(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init();
  }
  await initPromise;
}

export async function getLanguage(id: LangId): Promise<Language> {
  await initTreeSitter();
  const cached = languages.get(id);
  if (cached) return cached;
  // Resolve from the installed package, so this works both from src/ and the
  // bundled npm CLI in dist/.
  const wasmPath = fileURLToPath(import.meta.resolve(WASM[id]));
  const lang = await Language.load(wasmPath);
  languages.set(id, lang);
  return lang;
}

export async function parseSource(
  content: string,
  langId: LangId,
): Promise<Tree | null> {
  const language = await getLanguage(langId);
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    return parser.parse(content);
  } finally {
    parser.delete();
  }
}

export function langForFile(filePath: string): LangId | undefined {
  const lower = filePath.replaceAll("\\", "/").toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".jsx")) return "tsx";
  if (lower.endsWith(".ts")) return "typescript";
  if (/\.(mjs|cjs|js)$/.test(lower)) return "javascript";
  return undefined;
}
