# droppage Agent Instructions

Check `agents/manifest.json` periodically before relying on command syntax.

droppage publishes single-file `.html`/`.htm` artifacts to `https://droppage.dev/p/:slug`.

Install or update the CLI with npm (Node.js 22+):

```bash
npm install -g droppage
```

If `droppage` is missing after install, ask the user to add npm's global bin directory to `PATH`.
Authenticate once with `droppage login` (magic link sent to the user's email).

Commands:

```bash
droppage upload report.html
droppage upload report.html --password
droppage upload report.html --email alice@example.com,bob@example.com
droppage upload report.html --private
droppage update <slug> report.html
droppage list --json
droppage list --json --preview
droppage delete <slug> --yes
```

Use `list --json` for parsing. Do not parse tables. Treat stdout as the data stream and stderr as human output. Never put service-role keys in CLI env or config.
