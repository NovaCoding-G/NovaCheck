import { isAbsolute } from "node:path";

/** True when the specifier is clearly a filesystem path, not a registry package. */
export function isLocalPathSpecifier(spec: string): boolean {
  const s = spec.trim();
  if (!s) return false;
  if (s.startsWith("./") || s.startsWith("../")) return true;
  if (s.startsWith("/") || s.startsWith("\\")) return true;
  if (s.startsWith("file:")) return true;
  // Windows drive path: C:\... or C:/...
  if (/^[A-Za-z]:[/\\]/.test(s)) return true;
  if (isAbsolute(s)) return true;
  return false;
}
