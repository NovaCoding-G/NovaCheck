# ai-slop demo

**Do not install, run, or copy anything from this directory.** It is a
deliberately unsafe project whose only purpose is to give NovaCheck something
real to report. It is excluded from this repository's own policy in
`.novacheck.yml`, and it is never published to npm.

Nothing here is malicious: there is no payload, no obfuscation, and no code that
reaches a real host. Every line is a textbook mistake, written the way an
assistant writes it when nobody reviews the diff.

## Run the scanner on it

From the repository root:

```bash
npx novacheck examples/ai-slop --ghosts   # the ghost hunt only
npx novacheck examples/ai-slop            # everything
```

The full scan reports `Trust Score 0/100`, `BLOCKED`, with 12 critical findings.

## What it plants, and which detector catches it

| Location | Planted problem | Detector |
| --- | --- | --- |
| `package.json` | `dotenvv` — one character from `dotenv`, unregistered | `ghost-deps` (typosquat) |
| `package.json` | `axios-retry-helper` — plausible, does not exist | `ghost-deps` |
| `package.json` | `supabase-auth-helpers-nextjs` — the unscoped form of a real scoped package | `ghost-deps` |
| `AGENTS.md` | an install command for a package that does not exist | `ghost-deps` (docs) |
| `AGENTS.md` | `npx` on an unregistered name, run before any review | `ghost-deps` (docs) |
| `requirements.txt` | two PyPI packages that do not exist | `ghost-deps` |
| `package.json` | `postinstall` piping a remote script into a shell | `supply-chain` |
| `package.json` | dependency fetched over `git+http://` | `supply-chain` |
| `.env.example` | credentials pasted in "for convenience" | `secrets` |
| `src/app.ts` | `exec` on a request parameter | `dangerous-sinks` |
| `src/app.ts` | SQL built by string concatenation | `dangerous-sinks` |
| `src/app.ts` | `eval` on a request body | `dangerous-sinks` |
| `src/app.ts` | wildcard CORS together with credentials | `dangerous-sinks` |
| `src/app.ts` | TLS verification disabled globally | `dangerous-sinks` |
| `src/app.ts` | session token from `Math.random()`, fingerprint from MD5 | `insecure-crypto` |
| `src/profile.ts` | untrusted input written to `innerHTML` | `dangerous-sinks` |

## About the package names

Every unregistered name used here was verified as available on npm or PyPI when
the demo was written, and is intentionally implausible as a real project. They
are not registered by this project and never should be — see
[docs/RESEARCH.md](../../docs/RESEARCH.md) on why "registering it to protect
users" is not an acceptable move.

If a name here starts resolving, that is the point of the demo: the window
between a hallucinated name appearing in a file and someone else owning it.
