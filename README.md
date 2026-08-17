# NovaCheck

<p align="center">
  <img src="docs/assets/IMG_0966.png" alt="NovaCheck" width="180" />
</p>

<p align="center">
  <b>The AI invented a dependency. Someone else can register it.</b><br />
  NovaCheck finds package names your project references but that do not exist — before you install them.
</p>

<p align="center">
  <a href="https://github.com/NovaCoding-G/NovaCheck/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/NovaCoding-G/NovaCheck/ci.yml?branch=main&label=CI&logo=github" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/novacheck"><img src="https://img.shields.io/npm/v/novacheck?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/novacheck"><img src="https://img.shields.io/npm/dm/novacheck?logo=npm" alt="npm downloads" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License: MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/novacheck?logo=nodedotjs&label=node" alt="Node.js" /></a>
  <a href="https://docs.github.com/en/code-security/code-scanning"><img src="https://img.shields.io/badge/SARIF-GitHub%20Code%20Scanning-2088FF?logo=githubactions&logoColor=white" alt="SARIF" /></a>
  <a href="#privacy--design-principles"><img src="https://img.shields.io/badge/privacy-local--first-16794b" alt="Local-first" /></a>
  <a href="https://github.com/NovaCoding-G/NovaCheck"><img src="https://img.shields.io/github/stars/NovaCoding-G/NovaCheck?style=social" alt="GitHub stars" /></a>
</p>

```bash
npx novacheck .
```

Requires **Node.js 20+**. No account, no upload, no config.

---

## The 30-second demo

This repository ships a deliberately broken project. Run the scanner on it:

```bash
git clone https://github.com/NovaCoding-G/NovaCheck.git
cd NovaCheck
npx novacheck examples/ai-slop --ghosts
```

```text
BLOCKED  Trust Score 0/100

Ghost packages  6 package references do not resolve to a real package
  ✗ phantom-migrate (npm, does not exist) · AGENTS.md:9
      npx phantom-migrate --apply
  ✗ dotenvv (npm, looks like "dotenv") · package.json:13
  ✗ axios-retry-helper (npm, does not exist) · package.json:14
  ✗ supabase-auth-helpers-nextjs (npm, does not exist) · package.json:18
  ✗ requests-toolkit-lite (PyPI, does not exist) · requirements.txt:2
  … 1 more in the full report
```

Every name above was verified as unregistered when the demo was written.
`npm install` would have failed on some of them — and silently succeeded on any
that an attacker registers first.

<p align="center">
  <img src="docs/assets/novacheck-terminal.jpg" alt="NovaCheck blocking a risky AI-generated project" width="820" />
</p>

---

## Why this specific problem

Language models do not look packages up; they predict names. The predicted name
is plausible, memorable, and often unregistered. Anyone can register it and ship
whatever they want under it — the classic slopsquatting setup. It only takes one
developer, or one coding agent, copying the install command.

The reference does not start in `package.json`. It starts in prose:

1. a model writes `npm install supabase-auth-helpers-nextjs` in a README,
   a setup guide, an `AGENTS.md`, or a skill file;
2. a human or an agent runs it;
3. the name reaches a manifest, a lockfile, a container image, production.

**NovaCheck checks all three layers.** Manifests and imports, like other tools —
and install commands written in documentation and agent instruction files, which
is where the name exists first and where nothing else looks.

| Where a hallucinated name lives | Checked |
| --- | --- |
| `package.json`, `requirements.txt`, `pyproject.toml` | yes |
| `import` / `require` / `from … import` | yes |
| `npm i`, `npx`, `pnpm add`, `bun add`, `bunx` in `*.md` | yes |
| `pip install`, `uv add`, `poetry add`, `pipx install` in docs | yes |
| `AGENTS.md`, `SKILL.md`, `*.mdc`, `*.rules`, agent instruction files | yes |

Precision matters more than reach here, so NovaCheck deliberately does not check
what it cannot attribute: git/file/link/workspace dependencies are not registry
packages, Python import names are mapped to their real distribution
(`import yaml` → `PyYAML`), shared namespaces (`google`, `azure`) are skipped,
and documentation placeholders (`npm install <your-package>`) are ignored.

---

## The rest of the scan

The ghost hunt is the reason to install NovaCheck. Once it is running, seven more
detectors cover the risks that show up in the same commits, and a `0–100` Trust
Score turns the result into a single go / no-go signal.

| Detector | What it looks for |
| --- | --- |
| `ghost-deps` | Hallucinated / typosquatted npm & PyPI packages, including install commands in docs |
| `secrets` | Hardcoded credentials (secretlint + entropy) |
| `env-leak` | `.env` files unprotected or already tracked by Git |
| `supply-chain` | Dangerous lifecycle scripts, `git+http://` dependencies |
| `dangerous-sinks` | Shell/SQL injection, CORS `*`, TLS verify off, `eval`, XSS sinks, unsafe pickle/YAML |
| `insecure-crypto` | Weak crypto and predictable tokens in a security context |
| `ai-unreviewed` | AI-authored ranges no human reviewed (Agent Trace / SPDX) |
| `ai-presence` | Explicit AI markers and disclosures (informational only) |

Every finding carries a location, why it is a risk, and a fix prompt you can
paste into whichever assistant wrote the code.

<p align="center">
  <img src="docs/assets/novacheck-html-report.jpg" alt="NovaCheck HTML report with Trust Score and findings" width="820" />
</p>

---

## Use it as a gate

```bash
# ghost hunt only — fast, and the check that blocks releases
npx novacheck . --ghosts

# full scan, fail the build below a score, annotate the PR
npx novacheck . --fail-below 85 --sarif

# only what this branch introduced
npx novacheck . --changed origin/main

# no network: registry cache only
npx novacheck . --offline

# fail closed when an input could not be analyzed
npx novacheck . --fail-on-incomplete
```

In GitHub Actions:

```yaml
name: NovaCheck

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  security-events: write

jobs:
  trust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
        with:
          fetch-depth: 0
      - uses: NovaCoding-G/NovaCheck@v0.4.0
        with:
          fail-below: "85"
          fail-on-incomplete: "true"
          changed: "true"
          base: "origin/main"
```

`changed: true` is a diff gate, not a full-repository certification: run an
additional full scan on `main`. SARIF upload is skipped on fork pull requests
that lack `security-events: write`, so external contributors never break CI over
a permissions issue.

<details>
<summary>Other flags and policy file</summary>

```bash
npx novacheck . --only ghost-deps,secrets   # pick the checks
npx novacheck . --skip ai-presence          # drop the noisy-for-you ones
npx novacheck . --verbose                   # what was scanned and why
npx novacheck . --html .novacheck/report.html
npx novacheck . --sarif ./results.sarif
npx novacheck . --badge
npx novacheck . --policy .novacheck.yml
```

`.novacheck.yml`:

```yaml
minimumScore: 85
failOnIncomplete: true
failOn:
  - critical
ignore:
  detectors:
    - ai-presence          # transparency, not a vulnerability
  findings:
    - dangerous-sinks/example-approved-risk
  paths:
    - tests/fixtures/**
```

CLI flags override the policy file. The HTML report is written to
`.novacheck/report.html` by default; `--no-html` skips it.

Trust Score: findings subtract from 100 by severity (critical −25, high −12,
medium −5, low −2, info 0). Status follows your policy, not a vanity threshold.

</details>

---

## Public research

The detector is only credible if its findings hold up on real repositories, so
the evidence is generated by a script anyone can rerun:

```bash
bun run scripts/ghost-hunt.ts owner/repo --out research/reports
```

It clones shallowly, runs the ghost hunt, applies the scanned repository's own
policy, and writes a markdown report plus a JSON dataset. Disclosure rules,
report format, and what must never be published are in
[docs/RESEARCH.md](./docs/RESEARCH.md).

Found a hallucinated package NovaCheck missed, or a name it flagged wrongly?
That is the most useful issue you can open — there is
[a template for it](https://github.com/NovaCoding-G/NovaCheck/issues/new/choose),
and both outcomes become test fixtures.

---

## Privacy & design principles

- **Local-first** — analysis runs on your machine or your CI runner. Source code
  is never uploaded. The only network calls are registry metadata lookups
  (package names), and `--offline` removes them.
- **No style heuristics** — NovaCheck never guesses "this looks AI-written". AI
  provenance comes from explicit signals (Agent Trace, SPDX-AI-Disclosure,
  commit trailers, markers) or it is not reported.
- **Precision over reach** — a detector that cries wolf gets fixed or deleted.
  Version-blind CVE lookup was removed for exactly that reason.
- **Every finding is actionable** — location, cause, and a fix prompt.

## What NovaCheck is not

- Not a vulnerability database. It does not track CVEs or advisories; use
  `npm audit`, Dependabot, or a full SCA tool for that.
- Not a malware sandbox. It reads code and registry metadata; it never installs
  or executes your dependencies.
- Not a SAST platform. Its sink rules are a small, high-confidence set, not a
  replacement for CodeQL or Semgrep on a large codebase.
- Not a runtime or agent monitor. It runs before you ship, not while you serve.
- Not ecosystem-complete. Ghost detection covers npm and PyPI today.

---

## Development

Runtime for published packages: Node.js 20+. Development uses [Bun](https://bun.sh):

```bash
bun install
bun run check                      # typecheck + tests + build + CLI smoke
bun run src/cli.ts . --offline
```

Contributions: [CONTRIBUTING.md](./CONTRIBUTING.md) ·
Direction and non-goals: [docs/POSITIONING.md](./docs/POSITIONING.md) ·
Releases: [docs/releasing.md](./docs/releasing.md) ·
Vulnerabilities in NovaCheck itself: [SECURITY.md](./SECURITY.md).

---

MIT © [NovaCoding-G](https://github.com/NovaCoding-G) · novacodingg@gmail.com
