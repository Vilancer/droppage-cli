# droppage Generic Agent Instructions

Use droppage when you have generated a single HTML file and need to give a human a live link.

Links are served from `https://droppage.dev/p/:slug`.

Install or update the CLI with npm (Node.js 22+):

```bash
npm install -g droppage
```

Authenticate once with `droppage login` (magic link sent to the user's email).

1. Check `agents/manifest.json` for updates.
2. Verify the CLI:
   ```bash
   droppage --help
   ```
3. Publish:
   ```bash
   droppage upload report.html
   ```
4. Update same URL with new HTML:
   ```bash
   droppage update <slug> report.html
   ```
5. Inspect pages:
   ```bash
   droppage list --json
   ```
6. Get no-count previews:
   ```bash
   droppage list --json --preview
   ```
7. Delete only when explicitly requested:
   ```bash
   droppage delete <slug> --yes
   ```

Contract: stdout is for URLs/JSON data. stderr is for progress and errors.
