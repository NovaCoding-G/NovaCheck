# Positioning

This file exists so that every future decision — feature, README line, issue
triage, launch post — can be checked against one sentence instead of a mood.

## The one sentence

> NovaCheck finds package names a project references but that do not exist,
> including the install commands written in documentation and agent instruction
> files, and blocks them before they are installed.

Everything else in the tool is supporting cast. The seven other detectors are
real and useful, but they are not why someone installs NovaCheck, and they are
not what NovaCheck is known for.

## Why this and not "AI code security"

"Security for AI-generated code" is a sentence dozens of funded companies say in
2026. It describes a market, not a product, and a developer reading it cannot
tell what will happen when they run the tool.

"The AI invented a dependency and NovaCheck catches it" is different:

- **It is a specific, verifiable claim.** A package either resolves on the
  registry or it does not. There is no severity debate and no vendor opinion.
- **It is demonstrable in one command,** on a project the reader already has.
- **It has a gap nobody else covers.** Existing tools read manifests, lockfiles
  and imports. The hallucinated name appears earlier than all of them: in prose
  that a human copies and an agent executes.
- **It is memorable.** Being the tool for one named problem beats being the
  eighth tool for a broad one.

## In scope

- Ghost and typosquatted packages in manifests, imports, and install commands
  written in documentation or agent instruction files.
- npm and PyPI resolution, with precision fixes as they are discovered.
- Making the result usable as a gate: exit codes, policy, SARIF, GitHub Action.
- Reproducible public evidence that the problem is real (see `RESEARCH.md`).

## Out of scope

Each of these is a good product. None is this product.

- Vulnerability databases, CVE tracking, advisory feeds.
- Deep SAST or taint analysis competing with CodeQL and Semgrep.
- Dependency installation, sandboxing, or malware execution analysis.
- Runtime, agent, or production monitoring.
- A dashboard, an account system, or a hosted service.
- Style-based guessing of whether code was written by an AI. Provenance is read
  from explicit signals or not reported at all.

## The test for anything new

A change earns its place only if the answer is yes to all four:

1. Does it make a ghost package easier to catch, or harder to ignore?
2. Can it be explained in one sentence to someone who has never run the tool?
3. Is it verifiable — can a reader check the claim themselves?
4. Does it keep precision? A finding a maintainer has to argue with costs more
   trust than the finding was worth.

## Messaging rules

- Lead with the failure, not with the feature: the package that does not exist,
  not "comprehensive AI security scanning".
- Show output, never adjectives. Every claim in the README appears in real
  terminal output.
- State the limits before someone else does. `What NovaCheck is not` is a
  feature of the README, not an apology.
- Never describe a heuristic as a guarantee. "Verified against the registry" is
  true; "secure" is not.
- No urgency theatre, no invented statistics, no fear-based copy. The problem is
  interesting enough when stated plainly.
