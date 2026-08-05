import { lintSource } from "@secretlint/core";
import { creator as recommendPreset } from "@secretlint/secretlint-rule-preset-recommend";
import { createRawSource } from "@secretlint/source-creator";
import type { SecretLintCoreResultMessage } from "@secretlint/types";

const PRESET_ID = "@secretlint/secretlint-rule-preset-recommend";

export interface SecretlintHit {
  ruleId: string;
  messageId: string;
  message: string;
  severity: "error" | "warning" | "info";
  line: number;
  column: number;
  docsUrl?: string;
}

/**
 * Run the mature secretlint recommend preset on a single file.
 * Secrets in messages are masked by the engine.
 */
export async function lintFileWithSecretlint(
  absolutePath: string,
): Promise<SecretlintHit[]> {
  const source = await createRawSource(absolutePath);
  if (source.contentType !== "text") return [];

  const result = await lintSource({
    source,
    options: {
      maskSecrets: true,
      config: {
        rules: [
          {
            id: PRESET_ID,
            rule: recommendPreset,
          },
        ],
      },
    },
  });

  return result.messages.map(mapMessage);
}

function mapMessage(m: SecretLintCoreResultMessage): SecretlintHit {
  return {
    ruleId: m.ruleId,
    messageId: m.messageId,
    message: m.message,
    severity: m.severity === "info" ? "info" : m.severity === "warning" ? "warning" : "error",
    line: m.loc.start.line,
    column: m.loc.start.column,
    docsUrl: m.docsUrl,
  };
}

/** Exported for unit tests that lint in-memory content. */
export async function lintContentWithSecretlint(
  content: string,
  filePath = "virtual.ts",
): Promise<SecretlintHit[]> {
  const result = await lintSource({
    source: {
      content,
      filePath,
      ext: filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")) : ".ts",
      contentType: "text",
    },
    options: {
      maskSecrets: true,
      noPhysicFilePath: true,
      config: {
        rules: [
          {
            id: PRESET_ID,
            rule: recommendPreset,
          },
        ],
      },
    },
  });
  return result.messages.map(mapMessage);
}
