# Releasing droppage

The CLI is developed in a private monorepo and mirrored here for public review and publishing.
This repository is the **release surface**: every npm version is built and published from a tag
here by GitHub Actions using npm **trusted publishing** (OIDC), so each release carries a
provenance attestation linking it to a public commit.

## Release steps

1. **Bump the version** in `package.json` (the CLI's `--version` reads it — there is no other
   place to update) in the source repository and land the change there with tests green.
2. **Sync** the package into this repository (maintainers: `scripts/sync-cli-repo.sh` in the
   source repo; it runs a leak gate and mirrors `packages/cli/` + `agents/` here).
3. Review `git diff`, then commit:
   ```bash
   git add -A && git commit -m "vX.Y.Z"
   git push
   ```
4. Wait for **CI** to go green on `main`.
5. **Tag and push the tag** — this is the publish trigger:
   ```bash
   git tag vX.Y.Z && git push --follow-tags
   ```
6. Watch the **Release** workflow. It refuses to publish if the tag does not match
   `package.json`.
7. **Verify** on <https://www.npmjs.com/package/droppage>: new version listed, README rendered,
   and the green **provenance** check ("Built and signed on GitHub Actions"). Smoke test:
   ```bash
   npm exec -y droppage@X.Y.Z -- --version
   ```

## Rules and gotchas

- **Never `npm publish` by hand** after the initial 0.1.0 bootstrap. Publishing access on npm is
  set to *require 2FA and disallow tokens*; only the trusted-publisher workflow can publish.
- **Do not rename or move `.github/workflows/release.yml`.** The npm trusted-publisher binding is
  by workflow filename; renaming silently breaks releases until npm settings are updated.
- **Never `npm unpublish`** a version people may have installed (npm forbids it after 72h anyway).
  Ship a patch and mark the bad version: `npm deprecate droppage@X.Y.Z "reason"` (this is a
  maintainer 2FA action from a local machine).
- The README shown on npm comes from the **published tarball**, so README fixes need a release.
- `main` is branch-protected and `v*` tags are protected: a tag push is a publish.
- The tarball must contain exactly `dist/cli.js`, `package.json`, `README.md`, `LICENSE`, `NOTICE`
  — CI asserts this.
