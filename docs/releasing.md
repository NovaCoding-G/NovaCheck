# Releasing NovaCheck

NovaCheck publishes to npm from the `Release` GitHub Actions workflow. Human
maintainers create the Git tag and GitHub Release; npm publication is performed
with OpenID Connect and provenance, without a long-lived npm token.

## One-time npm configuration

In the npm package settings for `novacheck`, add a GitHub Actions trusted
publisher with:

- Organization or user: `NovaCoding-G`
- Repository: `NovaCheck`
- Workflow: `release.yml`
- Environment: `npm`
- Allowed actions: `npm publish`

Create a protected GitHub environment named `npm` and restrict deployment to
tags matching `v*`.

## Prepare a release

1. Update `package.json` and `src/version.ts` to the same SemVer version.
2. Move the matching `CHANGELOG.md` section from `Unreleased` to the release
   date.
3. Run:

   ```bash
   bun install --frozen-lockfile
   bun run check
   bun run scripts/check-packed-cli.ts
   bun run scripts/check-release-version.ts vX.Y.Z
   ```

4. Merge the release pull request into `main`.
5. Create a GitHub Release from tag `vX.Y.Z`, using the changelog section as
   release notes.

Publishing the release triggers `.github/workflows/release.yml`. The workflow
checks that the tag/version metadata match and that the tagged commit belongs
to `main`, reruns the full quality gate, dry-runs the package, and publishes
with npm provenance.

## Verify

After the workflow succeeds:

```bash
npm view novacheck version
npm exec --yes --package=novacheck@X.Y.Z -- novacheck --version
```

Move the `v0` floating Action tag only after the immutable `vX.Y.Z` tag and npm
package have both been verified.
