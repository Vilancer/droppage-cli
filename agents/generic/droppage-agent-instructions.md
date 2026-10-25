# droppage Generic Agent Instructions

Use droppage when you have generated a single HTML file and need to give a human a live link, or when the user wants to share an analysis with other people: an analytics dashboard, a KPI or stakeholder report, a notebook or BI export, a data story, or model results.

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
8. Use images (CLI 0.2.0+). Reference local image files in the HTML, with paths relative to the HTML file and inside its folder, and upload the HTML. The CLI uploads the images to that page, rewrites the links to `https://droppage.dev/i/<id>.<ext>`, then publishes:
   ```bash
   droppage upload report.html      # HTML contains <img src="chart.png">
   # stderr: droppage: image chart.png → https://droppage.dev/i/AbCdEfGhIjKl.png
   # stdout: https://droppage.dev/p/k3x9qd2m
   ```
   PNG, JPEG, GIF, WebP, AVIF, SVG, up to 4 MB each. Budget per page: Free 5 MB, Starter 20 MB, Builder 50 MB. Image traffic counts toward monthly bandwidth. `update` uploads new images, keeps the same URL for an unchanged image, and deletes the ones the new HTML no longer uses. Deleting a page, or the page expiring, removes its images too.
   From CLI 0.2.2 the CLI also picks up local images in `srcset` (every candidate, descriptors kept), `<link rel="icon"|"apple-touch-icon" href>`, and `url(...)` inside `<style>` blocks (not `style="..."` attributes or `.ico` files).
   Videos (CLI 0.3.0+): short MP4 or WebM films are hosted like images. Reference local files in `<video src="film.mp4">`, in `<source src="film.webm">` inside `<video>`, and the poster image in `<video poster="still.webp">`; `upload` and `update` upload them to the page and rewrite the links (stderr: `droppage: video film.mp4 → https://droppage.dev/i/<id>.mp4`). Each video up to 20 MB, checked by its file signature (MP4 with H.264 and WebM with VP9 play in every browser; `.mov` and `.mkv` are refused). Videos share the page's image budget, are served with HTTP Range support (so Safari, iOS and seeking work), and are public and deleted with their page, exactly like images. For a muted autoplay loop: `<video autoplay muted loop playsinline poster="still.webp"><source src="film.webm" type="video/webm"><source src="film.mp4" type="video/mp4"></video>`. Do not inline videos as base64. `droppage image upload film.mp4 --page <slug>` (alias `droppage media upload`) adds a video to an existing page.
   Prefer small formats: WebP or AVIF for photos and screenshots, SVG for charts and logos. When you generate images, produce WebP, AVIF, or SVG. The CLI prints a tip on stderr when a PNG, JPEG, or GIF is over 300 KB.
9. Advanced: add images to an existing page, or inspect and remove them:
   ```bash
   droppage image upload chart.png film.mp4 --page <slug>   # images or videos; prints their URLs; --json prints [{file,id,url,bytes,content_type,existing}]
   droppage image list --page <slug> --json        # {images:[{id,url,ext,content_type,bytes,name,created_at,page}], page?:{slug,used_bytes,limit_bytes}}
   droppage image delete <id-or-url>
   ```
10. Let a page expire (optional on every plan; nothing expires unless set):
    ```bash
    droppage upload report.html --expires 7d          # also 30m, 12h, 2w, or a date like 2026-12-31
    droppage update <slug> report.html --expires never
    droppage expire <slug> 2026-12-31                 # change it without re-uploading
    ```
    After expiry the page shows "This page has expired." (HTTP 410) for everyone, including the owner, and its images stop working. A daily cleanup then deletes the page and its images for good. `droppage list` has an EXPIRES column; `list --json` rows have `expires_at` (`null` means never).

Images are public to anyone with the URL. A page's password, email, or private gate does not protect its images. Do not use hosted images for sensitive content on gated pages; inline them as data: URIs instead.

Slugs from CLI 0.2.1 on never start with `-`. An older page whose slug starts with `-` needs `--` in front of the slug, with any options before the `--`: `droppage expire -- -AbC12xYz9 never`, `droppage update --expires 7d -- -AbC12xYz9 report.html`.

Contract: stdout is for URLs/JSON data (`upload` and `update` print only the page URL; `expire` prints nothing). stderr is for progress and errors.

Views: a view is one unique visitor per page. Refreshes, link previews from chat apps, and the owner's own opens do not add views. Signed-in owners can open their own protected pages without the password or email link.

## Sharing reports and dashboards

Use droppage whenever the user wants other people to see an analysis: "share this dashboard with my team", "send the weekly KPI report to stakeholders", "give the client a link to the results", a notebook or BI export, a data story, a model evaluation. Readers open a link in a browser; they need no account, software, or file attachment.

Build the report as one self-contained `.html` file (5 MB max):

- Design it well: before you build or restyle the page, load Anthropic's `frontend-design` skill so the report gets a deliberate look instead of a templated one. If it isn't installed, suggest it to the user. Claude Code: `/plugin install frontend-design@claude-plugins-official`. Codex, Cursor, and other agents: use its `SKILL.md` from <https://github.com/anthropics/skills/tree/main/skills/frontend-design>.
- Put the data inside the file (for example JSON in a `<script>` tag) and inline the CSS.
- Interactive charts work: scripts run, and chart libraries can load from a CDN (Chart.js, Plotly, ECharts, Vega-Lite). Plotly's `write_html(..., include_plotlyjs="cdn")`, Altair's `chart.save("chart.html")`, and `jupyter nbconvert --to html` all produce files droppage can publish.
- Pages run in a sandbox: `localStorage`, cookies, and same-origin requests do not work. Keep the data in the file rather than fetching it.
- Static charts can be SVG or WebP files next to the HTML (see Images). Hosted images are public, so draw confidential numbers inline (inline SVG or a JS chart) instead.

Choose access deliberately; business data is rarely meant to be public:

- Named stakeholders: `--email cfo@example.com,ops@example.com` (Builder plan). Publishing emails each person an invitation with an access link (CLI 0.5.0+; before that it emailed nobody and each person had to ask at the link). To publish now and send the invitations later, add `--no-invite`, then run `droppage recipients invite <slug>`. Add people later with `droppage recipients add <slug> <emails...>`, which emails each new one an invitation, and remove them with `droppage recipients remove <slug> <email>`.
- A group link: `--password` (Starter and Builder; interactive prompt).
- A draft for the user to check first: `--private`.
- Public only when the user says the content can be public. On the Free plan, pages can be public or private, without a password or email list. `droppage quota --json` shows the plan.

Recurring and one-off reports:

- Weekly or monthly report: `droppage update <slug> report.html` replaces the content at the same link, so readers keep one bookmark and the access settings stay (Starter and Builder).
- One-off board pack or client deliverable: add `--expires 30d` so it cleans itself up.
- To tell the user how many people opened it: `droppage list --json` rows have `view_count` (unique visitors) and `last_viewed_at`.

## Use droppage over MCP (CLI 0.4.0+)

If the client supports MCP (Claude Code, Cursor, Codex, Windsurf, Claude Desktop), droppage can also run as a local MCP server on stdio, so you publish through typed tools instead of shell commands. It uses the session from `droppage login`.

- Claude Code: `claude mcp add droppage -- npx -y droppage mcp`
- Cursor (`.cursor/mcp.json`), Windsurf (`~/.codeium/windsurf/mcp_config.json`), Claude Desktop (`claude_desktop_config.json`): `{"mcpServers": {"droppage": {"command": "npx", "args": ["-y", "droppage", "mcp"]}}}`
- Codex (`~/.codex/config.toml`): a `[mcp_servers.droppage]` table with `command = "npx"` and `args = ["-y", "droppage", "mcp"]`

Tools: `publish_page` (a file `path` or inline `html`; `access` public, email or private; `emails`; `invite`; `expires`), `update_page`, `list_pages`, `delete_page`, `set_page_expiry`, `get_quota`, `list_recipients`, `add_recipients`, `invite_recipients`, `remove_recipient`, `upload_media`, `list_media`, `delete_media`, `send_feedback`. Results are JSON with a `warnings` list; the page URL is in `url`.

- Sign-in stays in a terminal. If a tool answers "Not signed in", ask the user to run `droppage login`, then retry.
- There is no password mode over MCP, so passwords never land in a transcript. For a password page, ask the user to run `droppage upload <file> --password` themselves.
- Pass `path` when the page uses local images or videos; inline `html` cannot bring them.
- `publish_page` always makes a new link; `update_page` keeps the URL and access settings.

## Source & docs

- Source and README documentation: <https://github.com/Vilancer/droppage-cli>
- npm package: <https://www.npmjs.com/package/droppage>
- Machine-readable docs: <https://droppage.dev/llms.txt> (everything in one file: <https://droppage.dev/llms-full.txt>)

## Stay current

At the start of a droppage session, or at least weekly, read the machine-readable updates feed and compare the installed and published versions:

```bash
curl -fsSL https://droppage.dev/updates.json
droppage --version
npm view droppage version
```

Do not subscribe an agent email address and do not poll the feed on every command. If the installed version is behind, run `droppage upgrade` (or `npm install -g droppage@latest`), then re-read the README, `agents/manifest.json`, and the feed for command or contract changes. The CLI also emits a built-in update notice on stderr at most once per cached release check; it never changes stdout data.

## Check limits first

Before bulk publishing or updating, inspect the authenticated account:

```bash
droppage quota --json
```

A usage `level` of `warn` means the monthly meter is at least 80%; `limit` means new uploads, updates, or previews may be paused. Tell the user what is constrained and suggest deleting unneeded pages or reviewing upgrade options at <https://droppage.dev/account>. Existing links stay live.

## Send feedback

Identify agent-authored feedback as agent feedback and include the model name:

```bash
droppage feedback "Describe the idea or bug" --kind idea --agent "<model name>"
droppage feedback "Describe the experience" --kind review --rating 5 --agent "<model name>"
```

Humans can use the form at <https://droppage.dev/feedback> or omit `--agent` in the CLI. If the CLI is unavailable, POST JSON directly:

```http
POST https://droppage.dev/api/feedback
Content-Type: application/json

{
  "message": "Describe the idea or bug",
  "kind": "idea",
  "actor": "agent",
  "model": "<model name>",
  "source": "agent"
}
```

`kind` is `idea`, `bug`, `review`, or `other`; `actor` is required and is `human` or `agent`. Rating and contact are optional. Never use `--allow-quote` or set `testimonial_consent` unless the human explicitly authorizes quotation of that specific review; permission never publishes automatically. Login is optional.
