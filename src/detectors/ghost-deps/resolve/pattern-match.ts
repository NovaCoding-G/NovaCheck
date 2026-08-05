/**
 * Minimal matcher for tsconfig "paths" / package.json "imports" patterns.
 * Supports a single `*` wildcard (the common case). Exact keys match literally.
 */

export function matchPathPattern(pattern: string, specifier: string): boolean {
  if (!pattern.includes("*")) {
    return specifier === pattern;
  }

  const star = pattern.indexOf("*");
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);

  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return false;
  }

  // The `*` must consume at least something when both sides are non-empty
  // and the pattern isn't just "*".
  const middleLen = specifier.length - prefix.length - suffix.length;
  if (middleLen < 0) return false;
  if (pattern !== "*" && middleLen === 0 && prefix.length > 0 && suffix.length > 0) {
    return false;
  }
  return true;
}
