# droppage Agent Pack

Agents should check `agents/manifest.json` periodically before using droppage. The manifest is the stable discovery file for command syntax, stdout/stderr contracts, and instruction-pack locations.

Getting the CLI:

```bash
npm install -g droppage   # requires Node.js 22+
droppage login
```

Links are served from `https://droppage.dev/p/:slug`.

Install options:

- Codex: copy `agents/droppage-codex/` into the Codex skills directory.
- Cursor: copy `agents/cursor/droppage.mdc` into `.cursor/rules/`.
- Claude-style agents: add `agents/claude/droppage.md` to project context or `CLAUDE.md`.
- Generic agents: read `agents/generic/droppage-agent-instructions.md`.

Canonical raw manifest:

```text
https://raw.githubusercontent.com/Vilancer/droppage-cli/main/agents/manifest.json
```
