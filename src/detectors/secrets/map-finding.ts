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
    title: `Segreto hardcoded rilevato (${label})`,
    explanation:
      `È stato trovato un segreto con pattern noto (${label}) in \`${relFile}\` riga ${hit.line}. ` +
      `Se pubblichi il repo, chiunque può riusarlo (furto account, costi API, accesso a DB/cloud). ` +
      `I progetti generati dall'AI inseriscono spesso chiavi di esempio o di sviluppo direttamente nel codice. ` +
      `Dettaglio: ${hit.message}`,
    fixPrompt:
      `Nel file ${relFile} alla riga ${hit.line} c'è un segreto rilevato (${label}: ${hit.messageId}). ` +
      `Rimuovi il valore in chiaro, spostalo in una variabile d'ambiente (es. process.env / os.environ) ` +
      `o in un secret manager, aggiungi il file .env a .gitignore se necessario, e ruota/revoca subito ` +
      `il segreto compromesso sul provider. Non lasciare placeholder che sembrano chiavi reali.`,
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
    title: `Possibile segreto ad alta entropia: ${hit.name}`,
    explanation:
      `La variabile/chiave \`${hit.name}\` in \`${relFile}:${hit.line}\` ha un valore ad alta entropia ` +
      `(~${hit.entropy.toFixed(2)} bit/char, evidenza ${masked}). ` +
      `Combinato con un nome tipico di segreto, è un segnale forte di credenziale hardcoded. ` +
      `Se è un vero secret e il codice viene pubblicato, va considerato compromesso.`,
    fixPrompt:
      `In ${relFile} riga ${hit.line}, il valore assegnato a "${hit.name}" sembra un segreto hardcoded. ` +
      `Spostalo in una variabile d'ambiente o secret store, rimuovilo dal codice e dalla history se già commitato, ` +
      `e ruota il segreto. Se è un falso positivo (es. hash pubblico intenzionale), rinomina la variabile ` +
      `in modo che non suggerisca un secret oppure documenta perché è sicuro.`,
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
