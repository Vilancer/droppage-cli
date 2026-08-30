---
name: droppage-publish-html
description: Publish, update, list, preview, and delete single-file HTML reports with the droppage CLI. Use when Codex or an AI agent has generated an HTML artifact and needs to share it as a live URL with optional password, email allowlist, private draft, management, preview, or delete workflows.
---

# droppage HTML Publishing

## Before using droppage

Check the agent manifest for current command syntax and stream contracts before relying on automation:

```bash
curl -fsSL https://raw.githubusercontent.com/Vilancer/droppage-cli/main/agents/manifest.json
```

If the raw URL is unavailable, read `agents/manifest.json` in the repository.

Verify the CLI exists, installing it with npm (Node.js 22+) if needed:

```bash
droppage --help || npm install -g droppage
```

Links are served from `https://droppage.dev/p/:slug`. Authenticate once with `droppage login`
(magic link sent to the user's email); protected commands fail with a clear error if the user is
not logged in.

## Core workflows

Publish public HTML:

```bash
droppage upload report.html
```

Publish protected HTML:

```bash
droppage upload report.html --password
droppage upload report.html --email alice@example.com,bob@example.com
droppage upload report.html --private
```

Update an existing URL with new HTML only:

```bash
droppage update <slug> report.html
```

List machine-readable page metadata:

```bash
droppage list --json
```

Get preview URLs that should not increment views:

```bash
droppage list --json --preview
```

Delete without prompting only when the user has explicitly asked for deletion:

```bash
droppage delete <slug> --yes
```

## Stream contract

- Treat stdout as data: upload/update URL output and `list --json`.
- Treat stderr as human progress, warnings, prompts, and errors.
- Do not parse table output when `--json` is available.

## Constraints

- droppage accepts one `.html` or `.htm` file per upload/update.
- Inline assets when possible; relative assets may not resolve.
- Never put a Supabase service-role key in CLI env or config.
- `--password` is interactive in this release; do not invent an inline password flag.
- Views are raw successful renders, not unique visitors.
- Valid preview URLs suppress view counting.
