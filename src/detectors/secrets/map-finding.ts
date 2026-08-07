import type { Finding, Severity } from "../../types/index.ts";
import type { EntropyHit } from "./entropy.ts";
import { maskSecret } from "./entropy.ts";
import type { SecretlintHit } from "./secretlint-runner.ts";

function secretlintSeverity(sev: SecretlintHit["severity"]): Severity {
  if (sev === "error") return "critical";
  if (sev === "warning") return "high";
  return "medium";
}

function humanRuleLabel(ruleId: string): string {
  return ruleId
    .replace("@secretlint/secretlint-rule-", "")
    .replace(/-/g, " ");
}

export function findingFromSecretlint(
  hit: SecretlintHit,
  relFile: string,
): Finding {
  const label = humanRuleLabel(hit.ruleId);
  const severity = secretlintSeverity(hit.severity);
  return {
    id: `secrets:secretlint:${hit.ruleId}:${relFile}:${hit.line}:${hit.column}`,
    detectorId: "secrets",
    severity,
    title: `Hardcoded secret detected (${label})`,
    explanation:
      `A secret matching a known pattern (${label}) was found at \`${relFile}:${hit.line}\`. ` +
      `If the repository is published, anyone could reuse it for account theft, API charges, or database/cloud access. ` +
      `Details: ${hit.message}`,
    fixPrompt:
      `A secret was detected in ${relFile} at line ${hit.line} (${label}: ${hit.messageId}). ` +
      `Remove the plaintext value and move it to an environment variable (for example process.env or os.environ) ` +
      `or a secret manager. Add .env to .gitignore if needed, and immediately rotate or revoke ` +
      `the compromised credential with its provider. Do not leave placeholders that resemble real keys.`,
    file: relFile,
    line: hit.line,
    column: hit.column,
    evidence: hit.message,
    metadata: {
      engine: "secretlint",
      ruleId: hit.ruleId,
      messageId: hit.messageId,
      docsUrl: hit.docsUrl,
    },
  };
}

export function findingFromEntropy(
  hit: EntropyHit,
  relFile: string,
): Finding {
  const masked = maskSecret(hit.value);
  return {
    id: `secrets:entropy:${relFile}:${hit.line}:${hit.column}:${hit.name}`,
    detectorId: "secrets",
    severity: "high",
    title: `Possible high-entropy secret: ${hit.name}`,
    explanation:
      `The variable or key \`${hit.name}\` at \`${relFile}:${hit.line}\` has a high-entropy value ` +
      `(~${hit.entropy.toFixed(2)} bits/character, evidence ${masked}). ` +
      `Combined with a secret-like name, this is a strong signal of a hardcoded credential. ` +
      `If it is a real secret and the code is published, consider it compromised.`,
    fixPrompt:
      `In ${relFile} at line ${hit.line}, the value assigned to "${hit.name}" looks like a hardcoded secret. ` +
      `Move it to an environment variable or secret store, remove it from source and Git history if already committed, ` +
      `and rotate it. If this is a false positive (for example, an intentional public hash), rename the variable ` +
      `so it does not imply a secret, or document why it is safe.`,
    file: relFile,
    line: hit.line,
    column: hit.column,
    evidence: `${hit.name}=${masked}`,
    metadata: {
      engine: "entropy",
      name: hit.name,
      entropy: hit.entropy,
    },
  };
}
