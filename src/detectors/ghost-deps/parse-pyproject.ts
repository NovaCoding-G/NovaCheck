/**
 * Minimal pyproject.toml extractor for dependency names only.
 * Intentionally narrow (not a full TOML parser) to avoid extra deps and
 * keep false positives low — we only need package names, not full PEP 508.
 */

function parseRequirementName(dep: string): string | undefined {
  const trimmed = dep.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  const match = trimmed.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
  return match?.[1];
}

function extractQuotedStrings(block: string): string[] {
  const out: string[] = [];
  const re = /["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function findTableBlock(content: string, header: string): string | undefined {
  const re = new RegExp(
    `^\\[${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*$`,
    "m",
  );
  const start = content.search(re);
  if (start < 0) return undefined;
  const afterHeader = content.slice(start).split(/\r?\n/).slice(1);
  const lines: string[] = [];
  for (const line of afterHeader) {
    if (/^\s*\[/.test(line)) break;
    lines.push(line);
  }
  return lines.join("\n");
}

/** Collect dependency names from [project] / poetry tables. */
export function extractPyprojectDependencies(content: string): Array<{
  name: string;
  evidence: string;
}> {
  const results: Array<{ name: string; evidence: string }> = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const name = parseRequirementName(raw);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ name, evidence: raw });
  };

  // [project] dependencies = [ ... ]
  const projectBlock = findTableBlock(content, "project");
  if (projectBlock) {
    const depsMatch = projectBlock.match(
      /dependencies\s*=\s*\[([\s\S]*?)\]/,
    );
    if (depsMatch?.[1]) {
      for (const s of extractQuotedStrings(depsMatch[1])) push(s);
    }
  }

  // [project.optional-dependencies] groups
  const optBlock = findTableBlock(content, "project.optional-dependencies");
  if (optBlock) {
    for (const s of extractQuotedStrings(optBlock)) push(s);
  }

  // [tool.poetry.dependencies] / [tool.poetry.dev-dependencies] — keys are names
  for (const table of [
    "tool.poetry.dependencies",
    "tool.poetry.dev-dependencies",
    "tool.poetry.group.dev.dependencies",
  ]) {
    const block = findTableBlock(content, table);
    if (!block) continue;
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/);
      if (!m?.[1]) continue;
      if (m[1].toLowerCase() === "python") continue;
      push(m[1]);
    }
  }

  return results;
}
