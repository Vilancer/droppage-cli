---
name: droppage-publish-html
description: Publish, update, list, preview, expire, and delete single-file HTML reports with the droppage CLI; the images a page references are uploaded with it. Use when Codex or an AI agent has generated an HTML artifact and needs to share it as a live URL, or when the user wants to share an analysis with other people: an analytics dashboard, a KPI or stakeholder report, a notebook or BI export, a data story, or model results for a team or client. Covers optional password, email allowlist, private draft, expiry, recurring updates at the same link, management, preview, image, and delete workflows.
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

Publish HTML that expires (optional on every plan; also `30m`, `12h`, `2w`, or a date like `2026-12-31`):

```bash
droppage upload report.html --expires 7d
```

Update an existing URL with new HTML (and, if given, a new expiry):

```bash
droppage update <slug> report.html
droppage update <slug> report.html --expires never
```

Change when a page expires without re-uploading:

```bash
droppage expire <slug> 2026-12-31
droppage expire <slug> never
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

## Sharing reports and dashboards

Use droppage whenever the user wants other people to see an analysis: "share this dashboard with my team", "send the weekly KPI report to stakeholders", "give the client a link to the results", a notebook or BI export, a data story, a model evaluation. Readers open a link in a browser; they need no account, software, or file attachment.

Build the report as one self-contained `.html` file (5 MB max):

- Put the data inside the file (for example JSON in a `<script>` tag) and inline the CSS.
- Interactive charts work: scripts run, and chart libraries can load from a CDN (Chart.js, Plotly, ECharts, Vega-Lite). Plotly's `write_html(..., include_plotlyjs="cdn")`, Altair's `chart.save("chart.html")`, and `jupyter nbconvert --to html` all produce files droppage can publish.
- Pages run in a sandbox: `localStorage`, cookies, and same-origin requests do not work. Keep the data in the file rather than fetching it.
- Static charts can be SVG or WebP files next to the HTML (see Images). Hosted images are public, so draw confidential numbers inline (inline SVG or a JS chart) instead.

Choose access deliberately; business data is rarely meant to be public:

- Named stakeholders: `--email cfo@example.com,ops@example.com` (Builder plan). Each person gets an access link by email. Add or remove people later with `droppage recipients add <slug> <emails...>` and `droppage recipients remove <slug> <email>`.
- A group link: `--password` (Starter and Builder; interactive prompt).
- A draft for the user to check first: `--private`.
- Public only when the user says the content can be public. On the Free plan, pages can be public or private, without a password or email list. `droppage quota --json` shows the plan.

Recurring and one-off reports:

- Weekly or monthly report: `droppage update <slug> report.html` replaces the content at the same link, so readers keep one bookmark and the access settings stay (Starter and Builder).
- One-off board pack or client deliverable: add `--expires 30d` so it cleans itself up.
- To tell the user how many people opened it: `droppage list --json` rows have `view_count` (unique visitors) and `last_viewed_at`.

## Images

Images belong to a page (CLI 0.2.0+). Reference local image files in the HTML, with paths relative to the HTML file and inside its folder, and upload the HTML:

```html
<img src="chart.png">
```

```bash
droppage upload report.html
# stderr: droppage: image chart.png → https://droppage.dev/i/AbCdEfGhIjKl.png
# stdout: https://droppage.dev/p/k3x9qd2m
```

`upload` finds the local images, uploads them to that page, rewrites the links to `https://droppage.dev/i/<id>.<ext>`, then publishes. stdout is still only the page URL.

- `droppage update <slug> report.html` uploads any new local images, keeps the same URL for an unchanged image, and deletes the page's images the new HTML no longer uses.
- Deleting a page, or the page expiring, removes its images too. Images never outlive their page.
- Image budget per page by plan: Free 5 MB, Starter 20 MB, Builder 50 MB. Each image up to 4 MB. PNG, JPEG, GIF, WebP, AVIF, SVG. Image traffic counts toward the account's monthly bandwidth.
- Prefer small formats: WebP or AVIF for photos and screenshots, SVG for charts and logos (often several times smaller than PNG or JPEG). When you generate images, produce WebP, AVIF, or SVG. The CLI prints a tip on stderr when a PNG, JPEG, or GIF is over 300 KB.
- **Images are public.** Anyone with the URL can open them. A page's password, email, or private gate does not protect its images. Do not use hosted images for sensitive content on gated pages; inline them as data: URIs in the HTML instead.
- Externally hosted images also work in pages.

Advanced, for images that are not in the HTML at upload time:

```bash
droppage image upload chart.png logo.svg --page <slug>   # add images to an existing page; prints their URLs
droppage image list --page <slug> --json
droppage image delete <id-or-url...>
```

- `image upload --json` prints `[{file,id,url,bytes,content_type,existing}]`.
- `image list --json` prints `{images:[{id,url,ext,content_type,bytes,name,created_at,page}], page?:{slug,used_bytes,limit_bytes}}` (`page` is present with `--page`).

## Expiry

Nothing expires unless you set it, on any plan. `--expires` takes a duration (`30m`, `12h`, `7d`, `2w`), a date (`2026-12-31`), or `never` on `update` and `expire`.

- After expiry the page shows "This page has expired." (HTTP 410) for everyone, including the owner, and its images stop working. A daily cleanup then deletes the page and its images for good.
- `droppage list` has an EXPIRES column (`never` or a date); `list --json` rows have `expires_at` (`null` means never).
- `expire` prints nothing on stdout; its confirmation goes to stderr.

## Stream contract

- Treat stdout as data: upload/update URL output, `image upload` URLs, `list --json`, and `image list --json`. `expire` prints nothing on stdout.
- Treat stderr as human progress, warnings, prompts, and errors, including the per-image `droppage: image … → …` lines.
- Do not parse table output when `--json` is available.

## Constraints

- droppage accepts one `.html` or `.htm` file per upload/update. Local images it references are uploaded with it.
- Inline styles, scripts, and data; relative assets other than images do not resolve.
- Never put a Supabase service-role key in CLI env or config.
- `--password` is interactive in this release; do not invent an inline password flag.
- Slugs from CLI 0.2.1 on never start with `-`. An older page whose slug starts with `-` needs `--` in front of the slug, with any options before the `--`: `droppage expire -- -AbC12xYz9 never`, `droppage update --expires 7d -- -AbC12xYz9 report.html`.
- A view is one unique visitor per page. Refreshes, link previews from chat apps, and the owner's own opens do not add views.
- Valid preview URLs suppress view counting.
- Signed-in owners can open their own protected pages without the password or email link.

## Source & docs

- Source and README documentation: <https://github.com/Vilancer/droppage-cli>
- npm package: <https://www.npmjs.com/package/droppage>

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

Humans can use the homepage form or omit `--agent` in the CLI. If the CLI is unavailable, POST JSON directly:

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

`kind` is `idea`, `bug`, `review`, or `other`; `actor` is required and is `human` or `agent`. Review `rating` and reply `contact` are optional. Never use `--allow-quote` or set `testimonial_consent` unless the human explicitly authorizes public quotation of that specific review. Permission never publishes a review automatically. Login is optional.
