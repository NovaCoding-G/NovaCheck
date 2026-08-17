# Distribution playbook

NovaCheck has no marketing budget and no audience to borrow. The only thing that
travels is a specific, checkable claim plus the output that proves it. This file
is the operating manual for that.

## What actually earns attention

Developers share a tool when it does something they did not know was possible,
in less time than it takes to read about it. Everything below follows from that.

1. **The claim is one sentence and it is falsifiable.** "The AI invented a
   dependency; NovaCheck catches it before you install it."
2. **The proof is one command,** runnable on a repository the reader already has.
3. **The evidence is reproducible.** Numbers come with the script that produced
   them and the dataset behind them.
4. **The limits are stated by us, first.** Every credible reader is looking for
   the overclaim. Removing it removes the strongest objection.

What does not work, and should not be attempted: asking for stars, posting the
same announcement across ten communities, engagement-bait threads, invented
statistics, screenshots without commands, or claiming to replace a mature tool.

## Before any launch

The repository is the landing page. Before posting anywhere, all of this must be
true:

- [ ] `npx novacheck .` works on a clean machine with Node.js 20 and no config.
- [ ] The first screen of the README states the specific problem, not a category.
- [ ] Real terminal output appears above the fold.
- [ ] The demo (`examples/ai-slop`) reproduces the output shown in the README.
- [ ] `What NovaCheck is not` is present and honest.
- [ ] GitHub About text matches the one sentence; topics include
      `slopsquatting`, `hallucinated-packages`, `supply-chain-security`,
      `ai-code-review`, `sast`, `npm`, `pypi`, `cli`, `github-action`.
- [ ] A tagged release exists with a changelog entry that a stranger can read.
- [ ] The issue templates make a first contribution obvious.

## Channels, in priority order

**1. GitHub itself.** The repository is the product page, the demo, and the
distribution channel. Topics, About text, a release with real notes, an
`examples/` directory that runs, and issue templates that invite a specific kind
of contribution do more sustained work than any single post.

**2. Hacker News (Show HN).** One post, once, when the demo is undeniable. Title
and body below. Then answer every comment technically for the following hours —
the comment thread converts more than the post.

**3. A single subreddit at a time,** matched to the audience and written for it:
`r/node`, `r/Python`, `r/devops`, `r/netsec` for research results. Read the
rules, post the finding rather than the tool, and never cross-post the same text.

**4. A written research report** (dev.to, a personal blog, or the repository's
`research/` directory) once there is a hunt worth publishing. A report gets
linked; an announcement does not.

Everything else — X, LinkedIn, TikTok, Product Hunt — is a place to link the
above once it exists. It is not where the work happens.

## Show HN copy

Title (under 80 characters, no adjectives):

```text
Show HN: NovaCheck – find dependencies your AI invented before you install them
```

Body:

```text
Language models don't look packages up, they predict names. The predicted name is
plausible and often unregistered, so anyone can register it and ship whatever
they want under it.

The name usually doesn't start in package.json. It starts in prose: a setup guide
or an agent instruction file that says to install it. A human copies the command,
or an agent runs it, and only then does it reach a manifest and a lockfile.

NovaCheck reads all three layers — manifests, imports, and install commands
written in documentation and agent instruction files — and verifies each name
against npm or PyPI. Unresolvable names are reported as critical, with the file,
the line and the command as evidence.

There's a deliberately broken demo project in the repo, so you can see the output
before installing anything:

  git clone https://github.com/NovaCoding-G/NovaCheck.git
  npx novacheck NovaCheck/examples/ai-slop --ghosts

Local-first: source code never leaves the machine, the only network calls are
registry metadata lookups, and --offline removes them. TypeScript, MIT, runs as a
CLI or a GitHub Action with SARIF output.

Limits, up front: it's not a CVE database, not a SAST platform, not a sandbox,
and ghost detection covers npm and PyPI only. Precision is the whole point, so
false positives are the bug reports I want most.
```

## Answering the predictable objections

Answer them technically, concede what is true, and never argue about scope.

- *"`npm install` already fails on a nonexistent package."* True, and that is the
  good case. The bad case is the window before it fails: the name sitting in a
  guide, an agent instruction file or a manifest that someone else can register.
- *"Snyk / Socket / GitHub already do this."* They read manifests, lockfiles and
  imports, and they do it well. The gap is the install command in prose, which is
  where the hallucinated name appears first.
- *"This is just a registry lookup."* Yes — the lookup is the easy part. The work
  is knowing what to look up: git and workspace specifiers, `npm:` aliases, path
  aliases, monorepo packages, Python import names that differ from distributions,
  documentation placeholders.
- *"How many false positives?"* Give the real answer, name the known classes, and
  point at the fixtures. Never say "very few".

## Weekly cadence

One loop, repeated. Each item is small enough to finish.

1. **One precision fix** driven by a real repository, with a fixture.
2. **One hunt** on a stated population, following `RESEARCH.md`.
3. **One artifact**: a short report, a fixed detector class, or a documented
   install-command shape nobody was checking.

Never ship a week that is only content. The tool getting better is the story.

## What to measure

Signals that mean something: installs that recur, repositories running it in CI,
issues opened by strangers with real reproductions, findings confirmed by
maintainers, precision fixes shipped, and detector coverage of install-command
shapes.

Signals that mean nothing on their own: stars in the first week, post upvotes,
impressions, and follower counts. They are a side effect of the work above; they
are never the target, and they are never evidence that the tool is right.
