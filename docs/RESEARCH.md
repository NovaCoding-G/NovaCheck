# Ghost hunt research protocol

A scanner that claims hallucinated dependencies are a real problem has to show
it. This document defines how that evidence is produced, what may be published,
and what must not be.

Two properties matter more than any result: **every number is reproducible**, and
**no maintainer is publicly embarrassed for a mistake that took ten seconds to
make.**

## Running a hunt

```bash
# a few repositories
bun run scripts/ghost-hunt.ts owner/repo owner/other-repo

# a prepared list, redacting identities in the report
bun run scripts/ghost-hunt.ts --targets research/targets.txt --anonymize
```

For each target the script clones the default branch shallowly, runs the
`ghost-deps` detector, applies the scanned repository's own `.novacheck.yml`
policy, and writes two files to `research/reports/`:

- `ghost-hunt-<date>.md` — the human-readable report;
- `ghost-hunt-<date>.json` — the dataset behind every number in it.

The scanned repository's policy is applied on purpose. A project that excludes
test fixtures or intentionally vulnerable samples has already declared those
paths out of scope, and counting them would inflate results.

## Choosing targets

Choose by relevance to the question being asked, never by how likely a repository
is to look bad.

- State the population before scanning (for example: "the first 200 GitHub
  results for a topic, scanned on a given date").
- Do not remove repositories after seeing their results.
- Do not scan private code, forks of a single project, or anything gated by a
  licence that forbids it.
- Record the exact target list alongside the report so the run can be repeated.

## What a finding means

A ghost finding means exactly one thing: **a package name is referenced and does
not resolve on its registry, or closely resembles a popular package while showing
weak trust signals.**

It does not mean the repository is compromised, that the maintainer is careless,
or that an AI wrote the code. Reports must state this, and no report may imply
otherwise.

Before publishing any individual result, verify by hand:

1. the name really does not resolve (check the registry page directly);
2. the reference is real and current on the default branch;
3. it is not an internal, private-registry, or intentionally fictional name
   (documentation samples and teaching material are common and legitimate);
4. the ecosystem attribution is right (Python import names are not distribution
   names).

## Disclosure

1. **Before publication**, open an issue or contact the maintainers of any
   repository whose identity would appear in the report, with the exact location
   and the reason. Give them at least 14 days.
2. **A name that does not exist is a public opportunity for an attacker.** If a
   hallucinated name appears widely, notify the registry's security contact
   before publishing it broadly, and never register it "to protect users".
3. **Aggregate first.** Prefer "N of M repositories referenced at least one
   unregistered package" over naming a single project. Use `--anonymize` unless
   there is a concrete reason to identify a repository and its maintainers have
   been contacted.
4. **Corrections are part of the protocol.** If a finding turns out to be wrong,
   correct the report, publish the correction with the same visibility as the
   original claim, and add a regression test so the tool stops repeating it.

## Report template

```markdown
# Ghost hunt — <date>

Population: <how targets were selected, and when>
Tool: novacheck <version>, ghost-deps only
Result: <N> of <M> repositories referenced at least one unregistered package.

| Repository | Ghost refs | Packages | Trust Score |
| --- | --- | --- | --- |

## Evidence
<location, name, ecosystem, and whether it came from a manifest, an import, or
an install command in documentation>

## What this does not mean
<the limits above, stated explicitly>

## Method
<command, date, policy handling, reproduction steps>
```

## Turning findings into the tool

Every hunt should end with code, not only a report:

- a false positive becomes a fixture and a precision fix;
- a missed reference becomes a parser or resolver improvement;
- a new install-command shape becomes a test case.

That loop is the point. The research exists to make the detector harder to
dismiss, not to generate content.
