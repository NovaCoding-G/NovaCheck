import type { Severity } from "../../types/index.ts";

export type SinkKind =
  | "shell"
  | "sql"
  | "cors"
  | "tls"
  | "code-exec"
  | "xss"
  | "deserialization";

export interface SinkMatch {
  kind: SinkKind;
  severity: Severity;
  title: string;
  explanation: string;
  fixPrompt: string;
  file: string;
  line: number;
  column: number;
  evidence: string;
  ruleId: string;
}
