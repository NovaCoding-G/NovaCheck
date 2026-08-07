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
      "MD5/SHA1 used in a security context",
      "MD5/SHA1 are unsuitable for passwords, tokens, or signatures because they are broken and collision-prone.",
      "Replace them with SHA-256 or stronger; use Argon2/bcrypt/scrypt for passwords, and SHA-256 or HMAC for integrity.",
      "crypto-md5-sha1",
      hasSecurityContext,
    );
    pushMatches(
      findings,
      content,
      rel,
      CREATE_CIPHER_RE,
      "critical",
      "Deprecated/insecure crypto API (createCipher)",
      "crypto.createCipher is deprecated and derives keys with MD5, making it vulnerable.",
      "Use createCipheriv with an explicit key and IV derived by a modern KDF such as scrypt or PBKDF2.",
      "crypto-create-cipher",
    );
    pushMatches(
      findings,
      content,
      rel,
      MATH_RANDOM_SECRET_RE,
      "high",
      "Secret/token generated with Math.random",
      "Math.random is not a CSPRNG, so generated tokens are predictable.",
      "Use crypto.randomBytes or crypto.getRandomValues for tokens, session IDs, and nonces.",
      "crypto-math-random",
    );
    if (lang === "python") {
      pushMatches(
        findings,
        content,
        rel,
        PY_MD5_RE,
        "high",
        "Python MD5/SHA1 used in a security context",
        "MD5/SHA1 must not be used for passwords, tokens, or signatures.",
        "Use hashlib.sha256 or stronger, or dedicated libraries such as argon2 and bcrypt.",
        "crypto-py-md5-sha1",
        hasSecurityContext,
      );
      pushMatches(
        findings,
        content,
        rel,
        PY_RANDOM_SECRET_RE,
        "high",
        "Secret generated with non-cryptographic random",
        "Python's random module is unsuitable for security tokens.",
        "Use secrets.token_urlsafe() or secrets.token_hex().",
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
      explanation,
      fixPrompt: `${fixPrompt} Occurrence at ${file}:${line}.`,
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
