# Contributing to NovaCheck

NovaCheck prioritizes high-confidence findings over rule count.

## Development

```bash
bun install
bun run check
```

Every detector change should include:

1. a minimal vulnerable fixture;
2. a clean counterpart or false-positive test;
3. a finding with risk explanation and actionable fix prompt;
4. stable rule and finding identifiers.

Generated outputs (`dist`, `.novacheck`, package archives and `node_modules`)
must not be committed.

## Pull requests

Keep pull requests focused. Explain the security impact, precision trade-offs,
and how the change was tested. Rules that infer AI authorship from coding style
alone are not accepted; NovaCheck requires explicit provenance signals.
