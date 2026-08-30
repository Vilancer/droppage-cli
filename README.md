# droppage

> Drop an HTML file. Get a live link. Control who sees it.

`droppage` is a command-line tool that publishes a single HTML file to a live, shareable URL in one
command — with access control that feels like sharing a document, not deploying a website. It is
built for developers, analysts, and AI agents that produce HTML reports and need a URL without
running a hosting stack.

```bash
$ droppage upload report.html
https://droppage.dev/p/k3x9qd2m
```

Website: [droppage.dev](https://droppage.dev) · Source: [github.com/Vilancer/droppage-cli](https://github.com/Vilancer/droppage-cli)

## Install

Requires **Node.js 22 or newer**.

```bash
npm install -g droppage
droppage --version
```

## Quick start

```bash
droppage login                    # magic link sent to your email
droppage upload report.html       # prints the share URL on stdout
```

Open the printed link in any browser. That's it.

## Commands

| Command | What it does |
|---|---|
| `droppage login` | Authenticate with a magic link (session stored in `~/.droppage/config.json`). |
| `droppage logout` | Sign out and clear local credentials. |
| `droppage upload <file>` | Publish an `.html`/`.htm` file and print its URL. Options: `--password`, `--email <addr>`, `--private`. |
| `droppage update <slug> <file>` | Replace the HTML behind an existing URL. Keeps the URL, access mode, and stats. |
| `droppage list` | List your pages. `--json` for machines, `--preview` for no-count preview URLs. |
| `droppage delete <slug>` | Delete a page. `--yes` skips the confirmation prompt. |
| `droppage recipients list <slug>` | List recipients of an email-gated page (`--json`, `--page <n>`). |
| `droppage recipients add <slug> <emails...>` | Add recipients and queue their invitation emails. |
| `droppage recipients remove <slug> <email>` | Revoke a recipient; their invitation link stops working (`--yes`). |
| `droppage recipients resend <slug> <email>` | Queue a fresh invitation for an existing recipient. |

Run `droppage <command> --help` for full option details.

## Access modes

| Upload flag | Mode | Who can open the link |
|---|---|---|
| *(none)* | public | Anyone with the link. |
| `--password` | password | Visitors who enter the password (prompted securely at upload time). |
| `--email a@x.com,b@y.com` | email | Allowlisted addresses, verified by a magic link. Manage later with `recipients`. |
| `--private` | private | Only you (your account email). Useful for drafts. |

`--password`, `--email`, and `--private` are mutually exclusive. `update` never changes the access
mode — it only swaps the HTML.

## Rules for uploads

- One `.html` or `.htm` file per upload; the file is validated before any network call.
- Inline your assets (CSS, JS, images as data URIs). Relative asset paths will not resolve.
- Views shown by `list` are raw successful renders (including refreshes and crawlers), not unique visitors.
- Preview URLs (`list --preview`) never increment the view count.

## For agents and scripts

droppage keeps a strict stream contract so it is safe to call from automation:

- `upload` and `update` print **only the URL** on stdout.
- `list --json` and `recipients list --json` print **only JSON** on stdout.
- Progress, warnings, prompts, and errors go to **stderr**.
- Non-zero exit code on any failure.
- Use `--yes` on `delete` / `recipients remove` for non-interactive runs.

Ready-made instruction packs for Codex, Cursor, and Claude-style agents live in the
[`agents/`](https://github.com/Vilancer/droppage-cli/tree/main/agents) directory of the repository.

## Updating

```bash
npm update -g droppage      # upgrade to the latest release
droppage --version          # confirm the installed version
```

Releases are published from GitHub Actions with
[npm provenance](https://docs.npmjs.com/generating-provenance-statements), so every version on npm
is verifiably built from a tagged commit in the public repository.

## Configuration

droppage works with zero configuration against the hosted service. For self-hosted or development
setups, these environment variables are honoured (in order of precedence):

| Variable | Purpose |
|---|---|
| `DROPPAGE_SUPABASE_URL` / `DROPPAGE_SUPABASE_ANON_KEY` | Point the CLI at another backend. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Fallback names for the same. |
| `DROPPAGE_SHARE_BASE_URL` | Origin used when printing share URLs (default `https://droppage.dev`). |

## Security

- The CLI is a thin client. It holds **no secrets**: only a public (anon) API key and *your own*
  login session. All access control is enforced server-side.
- The CLI refuses to start if a privileged `service_role`/`sb_secret` key is found in its
  environment or config file — those keys must never be used with droppage.
- Passwords are hashed with bcrypt before they leave your machine.
- Your session is stored in `~/.droppage/config.json` with `0600` permissions.

## License

[Apache-2.0](./LICENSE) © 2026 Vilancer.
