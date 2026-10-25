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
| `droppage login` | Authenticate with a magic link (session stored in `~/.droppage/config.json`, or under `DROPPAGE_HOME`). |
| `droppage logout` | Sign out and clear local credentials. |
| `droppage upload <file>` | Publish an `.html`/`.htm` file (and the local images and videos it references) and print its URL. Options: `--password`, `--email <addr>` (with `--no-invite`), `--private`, `--expires <when>`. |
| `droppage update <slug> <file>` | Replace the HTML (and images and videos) behind an existing URL. Keeps the URL, access mode, and stats. `--expires <when\|never>` changes the expiry. |
| `droppage expire <slug> <when\|never>` | Set or clear when a page expires without re-uploading. |
| `droppage list` | List your pages, including an EXPIRES column. `--json` for machines (rows have `expires_at`), `--preview` for no-count preview URLs. |
| `droppage delete <slug>` | Delete a page and its images and videos. `--yes` skips the confirmation prompt. |
| `droppage recipients list <slug>` | List recipients of an email-gated page (`--json`, `--page <n>`). |
| `droppage recipients add <slug> <emails...>` | Add recipients and queue their invitation emails. |
| `droppage recipients remove <slug> <email>` | Revoke a recipient; their invitation link stops working (`--yes`). |
| `droppage recipients invite <slug>` | Email an invitation to everyone on the page who hasn't had one yet (after `upload --no-invite`, or to retry). |
| `droppage recipients resend <slug> <email>` | Queue a fresh invitation for an existing recipient. |
| `droppage image upload <files...> --page <slug>` | Advanced: add images (PNG, JPEG, GIF, WebP, AVIF, SVG; up to 4 MB each) or videos (MP4, WebM; up to 20 MB each) to an existing page and print their URLs. Alias: `droppage media upload`. `--json` prints `[{file,id,url,bytes,content_type,existing}]`. |
| `droppage image list [--page <slug>]` | List your pages' images and videos; with `--page`, one page and its image budget. `--json` for machines. |
| `droppage image delete <id-or-url...>` | Delete images or videos. They stop being served within 5 minutes; a browser that already loaded one may keep it up to a day. |
| `droppage quota` | Show the current plan, page usage, monthly meter, reset date, and enabled features. `--json` returns the account API body. |
| `droppage feedback <message>` | Send feedback without requiring login. Options: `--kind idea|bug|review|other`, `--agent [model]`, `--contact <email>`, review-only `--rating <1-5>` and `--allow-quote`. Quote permission never publishes automatically. |
| `droppage upgrade` | Install the latest CLI globally with npm and report the installed version. |
| `droppage mcp` | Run a local MCP server on stdio for AI agents (see [Use droppage over MCP](#use-droppage-over-mcp)). |

Run `droppage <command> --help` for full option details.

Slugs from 0.2.1 on never start with `-`. If an older page's slug does (say `-AbC12xYz9`), put `--` in front of
it, with any options before the `--`: `droppage expire -- -AbC12xYz9 never` or
`droppage update --expires 7d -- -AbC12xYz9 report.html`. The CLI prints the same hint when it happens.

## Access modes

| Upload flag | Mode | Who can open the link |
|---|---|---|
| *(none)* | public | Anyone with the link. |
| `--password` | password | Visitors who enter the password (prompted securely at upload time). |
| `--email a@x.com,b@y.com` | email | Allowlisted addresses, verified by a magic link. Each person is emailed an invitation when the page is published (0.5.0+); add `--no-invite` to send them later with `recipients invite`. |
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
- Besides `<img src>`, the CLI picks up local images in `srcset` on `<img>`/`<source>` (every
  candidate, descriptors kept), `<link rel="icon"|"apple-touch-icon" href>`, and `url(...)` inside
  `<style>` blocks (0.2.2+). Not picked up: `style="..."` attributes and `.ico` files.
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

## Videos

Short product films (CLI 0.3.0+) are hosted exactly like images. Reference local MP4 or WebM files,
and a poster image, in a `<video>`:

```html
<video autoplay muted loop playsinline poster="still.webp">
  <source src="film.webm" type="video/webm">
  <source src="film.mp4" type="video/mp4">
</video>
```

```bash
droppage upload page.html
# stderr: droppage: image still.webp → https://droppage.dev/i/AbCdEfGhIjKl.webp
# stderr: droppage: video film.webm → https://droppage.dev/i/MnOpQrStUvWx.webm
# stderr: droppage: video film.mp4 → https://droppage.dev/i/YzAbCdEfGhIj.mp4
```

- Picked up: `<video src>`, `<source src>` (inside `<video>`, and `<picture>` as before), and
  `<video poster>`. Same folder rule as images.
- Each video up to 20 MB (20,000,000 bytes), checked by its file signature, not its name: MP4
  (H.264 plays everywhere) and WebM (VP9). `.mov` and `.mkv` are refused; convert them first, e.g.
  `ffmpeg -i in.mov -c:v libx264 -pix_fmt yuv420p -movflags +faststart -an film.mp4`.
- Videos share the page's image budget (Free 5 MB, Starter 20 MB, Builder 50 MB per page), are
  pruned by `update` and deleted with the page, like images. Video traffic counts toward your
  monthly bandwidth.
- Served from `https://droppage.dev/i/<id>.mp4|webm` with HTTP Range support (`206 Partial Content`),
  so Safari, iOS and seeking work. Public to anyone with the URL, like images.
- No need to inline films as base64 any more. `droppage image upload film.mp4 --page <slug>` (or
  `droppage media upload`) adds a video to an existing page.

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

## Sharing reports and dashboards

droppage is a quick way to send an analysis to people who don't have your tools: a dashboard for your
team, a weekly KPI or stakeholder report, a client deliverable, a notebook export. They open a link.

- **Design it well.** Agents should load Anthropic's `frontend-design` skill before building the page, so
  the report gets a deliberate look instead of a templated one. Claude Code:
  `/plugin install frontend-design@claude-plugins-official`; Codex, Cursor, and other agents: use its
  `SKILL.md` from [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design).
- **Export one HTML file**, up to 5 MB, with the data inside it: `jupyter nbconvert --to html
  analysis.ipynb`, Plotly's `fig.write_html("report.html", include_plotlyjs="cdn")`, Altair's
  `chart.save("report.html")`, or your own Chart.js / ECharts page. Scripts run, so interactive
  charts work, and chart libraries can load from a CDN.
- **Pages run in a sandbox**: `localStorage`, cookies, and same-origin requests are not available, so
  keep the data in the file rather than fetching it.
- **Pick who sees it.** `--email cfo@example.com,ops@example.com` for named people (Builder; manage
  them later with `droppage recipients`), `--password` for a group link (Starter and Builder),
  `--private` for a draft. On the Free plan, pages can be public or private, without a password or email list.
- **Same link every week.** `droppage update <slug> report.html` replaces the report and keeps the
  link and its access settings (Starter and Builder). Use `--expires 30d` for one-off deliverables.
- **Views are people.** `droppage list --json` shows `view_count` (unique visitors) and
  `last_viewed_at` for each report.

## For agents and scripts

droppage keeps a strict stream contract so it is safe to call from automation:

- `upload` and `update` print **only the URL** on stdout, even when they upload images;
  `image upload` prints **only the image or video URL(s)**; `expire` prints **nothing** on stdout.
- `list --json`, `image list --json`, `recipients list --json`, and `quota --json` print **only JSON** on stdout.
- Progress, warnings, prompts, errors, and the per-file `droppage: image … → …` / `droppage: video … → …` lines go to **stderr**.
- Non-zero exit code on any failure.
- Use `--yes` on `delete` / `recipients remove` for non-interactive runs.

Ready-made instruction packs for Codex, Cursor, and Claude-style agents live in the
[`agents/`](https://github.com/Vilancer/droppage-cli/tree/main/agents) directory of the repository.
Machine-readable docs for agents and doc tools such as mcpdoc:
[droppage.dev/llms.txt](https://droppage.dev/llms.txt), or everything in one file at
[droppage.dev/llms-full.txt](https://droppage.dev/llms-full.txt).

## Use droppage over MCP

From 0.4.0, `droppage mcp` runs a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio, so
agents in Claude Code, Cursor, Codex, Windsurf, or Claude Desktop publish through typed tools instead of shell
commands. It runs on your machine and uses the session from `droppage login`; sign in once in a terminal first.

```bash
claude mcp add droppage -- npx -y droppage mcp          # Claude Code
```

Cursor (`.cursor/mcp.json`), Windsurf (`~/.codeium/windsurf/mcp_config.json`), and Claude Desktop
(`claude_desktop_config.json`):

```json
{ "mcpServers": { "droppage": { "command": "npx", "args": ["-y", "droppage", "mcp"] } } }
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.droppage]
command = "npx"
args = ["-y", "droppage", "mcp"]
```

Tools: `publish_page` (a file `path` or inline `html`; `access` public, email or private; `emails`; `invite`; `expires`), `update_page`, `list_pages`, `delete_page`, `set_page_expiry`, `get_quota`, `list_recipients`, `add_recipients`, `invite_recipients`, `remove_recipient`, `upload_media`, `list_media`, `delete_media`, `send_feedback`. Results are JSON with a `warnings` list.

- Signed out, every tool answers "Not signed in. Ask the user to run `droppage login` in a terminal, then retry."
  There is no login tool: login needs the terminal, and stdin belongs to the protocol.
- There is no password mode over MCP, so a password never lands in an agent transcript. Run
  `droppage upload <file> --password` yourself for a password page.
- Pass a file `path` when the page uses local images or videos; inline `html` cannot bring them.
- `update_page`, `delete_page`, `set_page_expiry`, `remove_recipient`, and `delete_media` are marked destructive, so MCP clients ask before running them.
- Any client you configure with this server can publish, change, and delete pages as you. Add it only to agents you trust with your droppage account.

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
| `DROPPAGE_HOME` | Folder for the login session and the release-check cache (default `~/.droppage`; 0.5.0+). Use it to keep a separate session for CI, scripts or a test backend: `DROPPAGE_HOME=/tmp/droppage-ci droppage login`. Read only from the environment, never from `./.env`. |

## Security

- The CLI is a thin client. It holds **no secrets**: only a public (anon) API key and *your own*
  login session. All access control is enforced server-side.
- The CLI refuses to start if a privileged `service_role`/`sb_secret` key is found in its
  environment or config file — those keys must never be used with droppage.
- Passwords are hashed with bcrypt before they leave your machine.
- Your session is stored in `~/.droppage/config.json` (or `$DROPPAGE_HOME/config.json`) with `0600`
  permissions. A project's `./.env` cannot move it.

## License

[Apache-2.0](./LICENSE) © 2026 Vilancer.
