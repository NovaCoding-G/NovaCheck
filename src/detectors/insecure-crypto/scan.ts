import { readFile } from "node:fs/promises";
import type { Finding } from "../../types/index.ts";
import { listTextFiles, TEXT_FILE_DISCOVERY_PATTERNS, toRel } from "../secrets/walk.ts";
import { langForFile } from "../dangerous-sinks/parser.ts";

export const INSECURE_CRYPTO_PATTERNS = [
  ...TEXT_FILE_DISCOVERY_PATTERNS,
  "createHash('md5'|'sha1'), Math.random for tokens, crypto.createCipher",
] as const;

const MD5_SHA1_RE =
  /createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)|\.createHash\s*\(\s*['"](?:md5|sha1)['"]/gi;
const CREATE_CIPHER_RE = /createCipher\s*\(|createDecipher\s*\(/g;
const MATH_RANDOM_SECRET_RE =
  /(?:token|secret|password|apiKey|api_key|session|nonce|otp)\s*[=:]\s*[^=\n]*Math\.random\s*\(/gi;
const PY_MD5_RE = /hashlib\.(md5|sha1)\s*\(/g;
const PY_RANDOM_SECRET_RE =
  /(?:token|secret|password|api_key|session)\s*=\s*[^\n]*random\.(?:random|randint)/gi;

export interface InsecureCryptoScanResult {
  findings: Finding[];
  filesReceived: number;
  filesAnalyzed: number;
  files: string[];
  discoveryPatterns: string[];
}

export async function runInsecureCryptoScan(
  rootDir: string,
): Promise<InsecureCryptoScanResult> {
  const all = await listTextFiles(rootDir);
  const findings: Finding[] = [];
  const analyzed: string[] = [];
  let filesAnalyzed = 0;

  for (const abs of all) {
    const lang = langForFile(abs);
    if (!lang) continue;
    const rel = toRel(rootDir, abs);
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    filesAnalyzed++;
    analyzed.push(abs);

    pushMatches(
      findings,
      content,
      rel,
      MD5_SHA1_RE,
      "high",
      "MD5/SHA1 usato in un contesto di sicurezza",
      "MD5/SHA1 non sono adatti a password, token o firme: sono rotti/collisionabili.",
      "Sostituisci con SHA-256+ o meglio ancora Argon2/bcrypt/scrypt per password; per integrità usa SHA-256 o HMAC.",
      "crypto-md5-sha1",
      hasSecurityContext,
    );
    pushMatches(
      findings,
      content,
      rel,
      CREATE_CIPHER_RE,
      "critical",
      "API crypto deprecata/insicura (createCipher)",
      "crypto.createCipher è deprecata e usa MD5 per derivare la chiave — vulnerabile.",
      "Usa createCipheriv con chiave e IV espliciti da una KDF moderna (scrypt/pbkdf2).",
      "crypto-create-cipher",
    );
    pushMatches(
      findings,
      content,
      rel,
      MATH_RANDOM_SECRET_RE,
      "high",
      "Segreto/token generato con Math.random",
      "Math.random non è CSPRNG: i token sono prevedibili.",
      "Usa crypto.randomBytes / crypto.getRandomValues per token, session id e nonce.",
      "crypto-math-random",
    );
    if (lang === "python") {
      pushMatches(
        findings,
        content,
        rel,
        PY_MD5_RE,
        "high",
        "MD5/SHA1 Python usato in un contesto di sicurezza",
        "MD5/SHA1 non vanno usati per password, token o firme.",
        "Usa hashlib.sha256+ o libraries dedicate (argon2, bcrypt).",
        "crypto-py-md5-sha1",
        hasSecurityContext,
      );
      pushMatches(
        findings,
        content,
        rel,
        PY_RANDOM_SECRET_RE,
        "high",
        "Segreto generato con random non criptografico",
        "Il modulo random non è adatto a token di sicurezza.",
        "Usa secrets.token_urlsafe() / secrets.token_hex().",
        "crypto-py-random",
      );
    }
  }

  return {
    findings,
    filesReceived: all.length,
    filesAnalyzed,
    files: analyzed,
    discoveryPatterns: [...INSECURE_CRYPTO_PATTERNS],
  };
}

function pushMatches(
  findings: Finding[],
  content: string,
  file: string,
  re: RegExp,
  severity: Finding["severity"],
  title: string,
  explanation: string,
  fixPrompt: string,
  ruleId: string,
  shouldReport: (
    match: RegExpExecArray,
    content: string,
  ) => boolean = () => true,
): void {
  const used = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = used.exec(content)) !== null) {
    if (!shouldReport(m, content)) continue;
    const before = content.slice(0, m.index);
    const line = before.split(/\r?\n/).length;
    findings.push({
      id: `insecure-crypto:${ruleId}:${file}:${line}`,
      detectorId: "insecure-crypto",
      severity,
      title,
      explanation:
        `${explanation} Nei progetti AI è comune copiare snippet obsoleti da StackOverflow.`,
      fixPrompt: `${fixPrompt} Occorrenza in ${file}:${line}.`,
      file,
      line,
      evidence: m[0].slice(0, 80),
      metadata: { ruleId },
    });
  }
}

function hasSecurityContext(
  match: RegExpExecArray,
  content: string,
): boolean {
  const lineStart = content.lastIndexOf("\n", match.index) + 1;
  const previousLineStart =
    lineStart > 0
      ? content.lastIndexOf("\n", Math.max(0, lineStart - 2)) + 1
      : 0;
  const nextLineBreak = content.indexOf(
    "\n",
    match.index + match[0].length,
  );
  const context = content
    .slice(
      previousLineStart,
      nextLineBreak === -1 ? content.length : nextLineBreak,
    )
    .toLowerCase();
  return /\b(?:password|passwd|pwd|pw|secret|token|credential|auth|signature|signing|hmac|session)\b/.test(
    context,
  );
}
