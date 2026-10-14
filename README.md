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
| `droppage upload <file>` | Publish an `.html`/`.htm` file (and the local images it references) and print its URL. Options: `--password`, `--email <addr>`, `--private`, `--expires <when>`. |
| `droppage update <slug> <file>` | Replace the HTML (and images) behind an existing URL. Keeps the URL, access mode, and stats. `--expires <when\|never>` changes the expiry. |
| `droppage expire <slug> <when\|never>` | Set or clear when a page expires without re-uploading. |
| `droppage list` | List your pages, including an EXPIRES column. `--json` for machines (rows have `expires_at`), `--preview` for no-count preview URLs. |
| `droppage delete <slug>` | Delete a page and its images. `--yes` skips the confirmation prompt. |
| `droppage recipients list <slug>` | List recipients of an email-gated page (`--json`, `--page <n>`). |
| `droppage recipients add <slug> <emails...>` | Add recipients and queue their invitation emails. |
| `droppage recipients remove <slug> <email>` | Revoke a recipient; their invitation link stops working (`--yes`). |
| `droppage recipients resend <slug> <email>` | Queue a fresh invitation for an existing recipient. |
| `droppage image upload <files...> --page <slug>` | Advanced: add images (PNG, JPEG, GIF, WebP, AVIF, SVG; up to 4 MB each) to an existing page and print their URLs. `--json` prints `[{file,id,url,bytes,content_type,existing}]`. |
| `droppage image list [--page <slug>]` | List your pages' images; with `--page`, one page and its image budget. `--json` for machines. |
| `droppage image delete <id-or-url...>` | Delete images. Cached copies may still show for up to a day. |
| `droppage quota` | Show the current plan, page usage, monthly meter, reset date, and enabled features. `--json` returns the account API body. |
| `droppage feedback <message>` | Send feedback without requiring login. Options: `--kind idea|bug|review|other`, `--agent [model]`, `--contact <email>`, review-only `--rating <1-5>` and `--allow-quote`. Quote permission never publishes automatically. |
| `droppage upgrade` | Install the latest CLI globally with npm and report the installed version. |

Run `droppage <command> --help` for full option details.

## Access modes

| Upload flag | Mode | Who can open the link |
|---|---|---|
| *(none)* | public | Anyone with the link. |
| `--password` | password | Visitors who enter the password (prompted securely at upload time). |
| `--email a@x.com,b@y.com` | email | Allowlisted addresses, verified by a magic link. Manage later with `recipients`. |
| `--private` | private | Only you (your account email). Useful for drafts. |

`--password`, `--email`, and `--private` are mutually exclusive. `update` never changes the access
mode — it only swaps the HTML. When you are signed in to droppage.dev, your own protected pages
open directly, without the password or email link.

## Rules for uploads

- One `.html` or `.htm` file per upload; the file is validated before any network call.
- Inline your CSS, JS, and data. Relative asset paths other than images will not resolve. Local
  images referenced in `<img src>` are uploaded with the page (see below); sensitive images belong
  inline as data: URIs.
- Views shown by `list` count one unique visitor per page. Refreshes, reopening in the same browser,
  link previews from chat apps, and your own opens do not add views.
- Preview URLs (`list --preview`) never increment the view count.

## Images

Images belong to a page. Reference local image files in your HTML (inside the HTML file's folder; `../` and absolute paths are ignored), with paths relative to the HTML
file, and upload it:

```html
<img src="chart.png">
```

```bash
$ droppage upload report.html
droppage: image chart.png → https://droppage.dev/i/AbCdEfGhIjKl.png
https://droppage.dev/p/k3x9qd2m
```

`upload` finds the images, uploads them to that page, rewrites the links to
`https://droppage.dev/i/<id>.<ext>`, then publishes. The image lines go to stderr; stdout is still
only the page URL.

- `update` uploads any new local images, keeps the same URL for an unchanged image, and deletes
  the page's images the new HTML no longer uses.
- Deleting a page, or the page expiring, removes its images too. Images never outlive their page.
- Image budget per page by plan: Free 5 MB, Starter 20 MB, Builder 50 MB. Each image up to 4 MB.
  PNG, JPEG, GIF, WebP, AVIF, SVG. Image traffic counts toward your monthly bandwidth.
- Prefer small formats: WebP or AVIF for photos and screenshots, SVG for charts and logos (often
  several times smaller than PNG or JPEG). The CLI prints a tip on stderr when a PNG, JPEG, or GIF
  is over 300 KB.
- **Images are public** to anyone with the URL. A page's password, email, or private gate does not
  protect them. Keep sensitive images inline in the HTML as data: URIs instead.
- Advanced: `droppage image upload <files...> --page <slug>` adds images to an existing page and
  prints their URLs; `droppage image list [--page <slug>] [--json]` shows them (`--json` prints
  `{images:[{id,url,ext,content_type,bytes,name,created_at,page}], page?:{slug,used_bytes,limit_bytes}}`);
  `droppage image delete <id-or-url...>` removes them.

## Expiry

Pages can expire. Nothing expires unless you set it, on any plan.

```bash
droppage upload report.html --expires 7d          # also 30m, 12h, 2w, or a date like 2026-12-31
droppage update <slug> report.html --expires never
droppage expire <slug> 2026-12-31                 # change it without re-uploading; `never` clears it
```

After expiry the page shows "This page has expired." (HTTP 410) to everyone, including you, and
its images stop working. A daily cleanup then deletes the page and its images for good.
`droppage list` shows an EXPIRES column (`never` or a date); `list --json` rows have `expires_at`
(`null` means never).

## For agents and scripts

droppage keeps a strict stream contract so it is safe to call from automation:

- `upload` and `update` print **only the URL** on stdout, even when they upload images;
  `image upload` prints **only the image URL(s)**; `expire` prints **nothing** on stdout.
- `list --json`, `image list --json`, `recipients list --json`, and `quota --json` print **only JSON** on stdout.
- Progress, warnings, prompts, errors, and the per-image `droppage: image … → …` lines go to **stderr**.
- Non-zero exit code on any failure.
- Use `--yes` on `delete` / `recipients remove` for non-interactive runs.

Ready-made instruction packs for Codex, Cursor, and Claude-style agents live in the
[`agents/`](https://github.com/Vilancer/droppage-cli/tree/main/agents) directory of the repository.

## Updating

```bash
droppage upgrade            # upgrade to the latest release
droppage --version          # confirm the installed version
```

After a command finishes, interactive terminals check npm for a new release at most once every 24
hours and put any update notice on stderr only. The check sends no identifier or usage data, and
all errors are ignored. Set `DROPPAGE_NO_UPDATE_CHECK=1` to opt out. This registry lookup is the
CLI's only non-backend network request; droppage still collects no telemetry.

Before bulk publishing, use `droppage quota --json`. A `warn` level means the monthly meter is at
least 80% used; `limit` means new uploads, updates, or previews may pause. Existing links remain
live. Delete unneeded pages or review plan options at [droppage.dev/account](https://droppage.dev/account).

Feedback is public and login is optional:

```bash
droppage feedback "The preview command should…" --kind idea
droppage feedback "Upload failed after…" --kind bug --agent "my-model"
```

Agent-authored feedback should always use `--agent` and include the model name.

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
| `DROPPAGE_NO_UPDATE_CHECK` | Set to `1` to disable the optional 24-hour npm release check. |

## Security

- The CLI is a thin client. It holds **no secrets**: only a public (anon) API key and *your own*
  login session. All access control is enforced server-side.
- The CLI refuses to start if a privileged `service_role`/`sb_secret` key is found in its
  environment or config file — those keys must never be used with droppage.
- Passwords are hashed with bcrypt before they leave your machine.
- Your session is stored in `~/.droppage/config.json` with `0600` permissions.

## License

[Apache-2.0](./LICENSE) © 2026 Vilancer.
