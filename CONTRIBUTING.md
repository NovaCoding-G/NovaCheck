# Contributing to NovaCheck

NovaCheck prioritizes high-confidence findings over rule count. A finding a
maintainer has to argue with costs more trust than the finding was worth.

Read [docs/POSITIONING.md](./docs/POSITIONING.md) before proposing anything
large: it states what NovaCheck is for and, more usefully, what it refuses to
become.

## The most valuable contributions

In order:

1. **A hallucinated package NovaCheck missed.** A real reference — in a manifest,
   an import, or an install command in documentation — that should have been
   flagged and was not.
2. **A false positive.** A name reported as a ghost that is legitimate: a private
   registry package, an `npm:` alias, a workspace package, a Python import whose
   distribution has a different name, a documentation placeholder.
3. **A new install-command shape.** Package managers, runners and agent
   instruction formats keep appearing; each unparsed shape is a blind spot.

All three become fixtures. Both directions of failure are equally welcome.

## Development

```bash
bun install
bun run check          # versioncheck + typecheck + tests + build + CLI smoke
```

Every detector change should include:

1. a minimal vulnerable fixture;
2. a clean counterpart or false-positive test;
3. a finding with a risk explanation and an actionable fix prompt;
4. stable rule and finding identifiers.

Fixtures live in `tests/fixtures/` and are excluded from the project's own scan.
Never use a package name that exists on a real registry as a stand-in for a ghost
package, and never register a name to make a test pass.

Generated outputs (`dist`, `.novacheck`, package archives and `node_modules`)
must not be committed.

## Research contributions

Reports produced with `scripts/ghost-hunt.ts` follow
[docs/RESEARCH.md](./docs/RESEARCH.md): the population is stated before the hunt,
findings are verified by hand, maintainers are contacted before their repository
is identified, and corrections are published as visibly as the original claim.
Pull requests adding reports that skip those steps will be closed.

## Pull requests

Keep pull requests focused. Explain the security impact, the precision
trade-offs, and how the change was tested. Rules that infer AI authorship from
coding style alone are not accepted; NovaCheck requires explicit provenance
signals.
