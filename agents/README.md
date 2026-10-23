# droppage Agent Pack

Agents should check `agents/manifest.json` and `https://droppage.dev/updates.json` at session start or at least weekly before using droppage. The manifest is the stable discovery file for command syntax, stdout/stderr contracts, and instruction-pack locations; the updates feed carries compatibility notes. Agents should not join the human email list or poll on every command.

Getting the CLI:

```bash
npm install -g droppage   # requires Node.js 22+
droppage login
```

Links are served from `https://droppage.dev/p/:slug`. Local images a page references in `<img src>` are uploaded with it (CLI 0.2.0+), and so are local MP4/WebM videos in `<video src>`, `<source src>` and `<video poster>` (CLI 0.3.0+, up to 20 MB each); they are served from `https://droppage.dev/i/:id`, and are public to anyone with the URL; they are deleted with their page. Pages can expire with `--expires` or `droppage expire`.

Install options:

- Codex: copy `agents/droppage-codex/` into the Codex skills directory.
- Cursor: copy `agents/cursor/droppage.mdc` into `.cursor/rules/`.
- Claude-style agents: add `agents/claude/droppage.md` to project context or `CLAUDE.md`.
- Generic agents: read `agents/generic/droppage-agent-instructions.md`.

Canonical raw manifest:

```text
https://raw.githubusercontent.com/Vilancer/droppage-cli/main/agents/manifest.json
```
