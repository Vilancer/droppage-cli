# Claude instructions for the droppage CLI

This file is read by AI coding agents working on this package. It applies both in the private
monorepo (`packages/cli/`) and in the public mirror (`Vilancer/droppage-cli`). Follow every rule.

## 1. The CLI is a thin client — keep it that way

- **Never add business logic, billing/plan logic, entitlement checks, or privileged operations to
  the CLI.** All enforcement (access control, quotas, plan limits, recipient caps, view counting)
  lives server-side behind Postgres RLS and server APIs. The CLI only calls those APIs with the
  user's own session. Anything a user could bypass by editing the CLI does not belong in the CLI.
- If a feature seems to need privileged access from the CLI, stop: the correct design is a
  server-side endpoint that performs the check, called by the CLI with the user's JWT.

## 2. Secrets (ARCH-02) — zero tolerance

- The only credentials that may appear in this package are the **public Supabase anon key** and
  URL in `src/lib/supabase-defaults.ts`. Nothing else. Ever.
- Never introduce `service_role` / `sb_secret` keys, Vercel/Resend/Lemon Squeezy tokens, Management
  API tokens, or any `.env` file — not in code, tests, fixtures, docs, or commit messages.
- `rejectSecrets` (`src/lib/env.ts`) and `validateConfig` (`src/lib/config.ts`) must stay in place
  and keep rejecting privileged keys. Do not weaken or bypass them.
- Never print tokens, session contents, or full JWTs in logs or error messages.

## 3. Privacy and telemetry

- The CLI collects **no telemetry** and sends nothing to any endpoint other than the configured
  backend. Do not add analytics, crash reporting, or "phone home" behaviour without an explicit,
  documented product decision.
- Do not log, cache, or transmit the contents of users' HTML files anywhere except the upload call.

## 4. Dependencies — Package Legitimacy Gate

Before adding or upgrading a dependency, a human must verify on npmjs.com: the publisher/maintainer
is who you expect, the package links to a real repository, it has no `install`/`postinstall`
scripts, and the version is the intended one (no typosquats). Prefer removing dependencies over
adding them; the published bundle should stay small and auditable. Pin exact versions.

## 5. Public repository hygiene

The CLI source is published openly. Everything in this package must be safe for public eyes:

- Never reference private planning documents (`.planning/`), internal roadmaps, pricing
  experiments, billing internals, infrastructure runbooks, hosting providers, or business
  strategy in code, comments, tests, docs, or commit messages.
- Keep operator/infra concerns (deploy tokens, email providers, dev/test domains) **out** of this
  package and the `agents/` instruction pack. Those live in the private monorepo only.
- Do not commit anything from the monorepo other than `packages/cli/` and `agents/` to the public
  repo. The sync script enforces this; do not work around it.

## 6. Output contract is a compatibility promise

Agents depend on it: `upload`/`update` print only the URL on stdout; `list --json` and
`recipients list --json` print only JSON on stdout; everything human goes to stderr; failures exit
non-zero. Changing this is a breaking change and needs a major version bump.

## 7. Releases

Versions are single-sourced from `package.json` (`--version` reads it). Publishing happens only
from the public repo's tag-triggered GitHub Actions workflow via npm trusted publishing —
never run `npm publish` from the monorepo (a `prepublishOnly` guard blocks it).
