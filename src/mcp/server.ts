import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { User } from '@supabase/supabase-js';
import { z } from 'zod';

import pkg from '../../package.json' with { type: 'json' };
import { parseExpiry } from '../lib/duration.js';
import { cleanEmails } from '../lib/emails.js';
import { isMediaFile, referencesLocalMedia } from '../lib/html-images.js';
import { MAX_UPLOAD_BYTES } from '../lib/validate-html.js';
import { collectNotices, notify } from '../lib/notify.js';
import { getCurrentUser } from '../services/auth.js';
import { submitFeedback } from '../services/feedback.js';
import { deleteImage, listImages, uploadImage } from '../services/images.js';
import { fetchPreviewUrls, pageJson } from '../services/page-list.js';
import { deletePage, listPages, setPageExpiry } from '../services/pages.js';
import { publishPage, resolveAccess, updatePage } from '../services/publish.js';
import { fetchQuota } from '../services/quota.js';
import { addRecipients, listRecipients, removeRecipient } from '../services/recipients.js';

export const NOT_SIGNED_IN =
  'Not signed in. Ask the user to run `droppage login` in a terminal, then retry.';

export const SERVER_INSTRUCTIONS = `droppage publishes a single HTML file (a report, dashboard, or any generated page) to a live link at https://droppage.dev/p/<slug>, with access control.

- Sign-in happens outside MCP: if a tool answers "Not signed in", ask the user to run \`droppage login\` in a terminal, then retry. Never ask for keys or tokens.
- Every publish_page call creates a NEW link. To change a page someone already has, use update_page with its slug: same URL, same access settings.
- A page's access mode is set when it is published and no tool changes it. To share it differently, publish a new link with the new access (and delete the old one if the user wants); never promise to change access later.
- Choose access deliberately. email: only the listed people, who enter their email at the link to get an access link (Builder plan); add_recipients also emails new people an invitation. private: only the owner, for a draft. public: anyone with the link, only when the user says the content can be public. For a password page, ask the user to run \`droppage upload <file> --password\` in a terminal: passwords never go through MCP.
- Pages are one self-contained HTML file up to 5 MB. Local images and videos the HTML references (paths relative to the file, inside its folder) are uploaded with it when you pass \`path\`; inline \`html\` cannot carry them.
- Before building a page, load Anthropic's frontend-design skill so the report doesn't look templated.
- Before bulk publishing, call get_quota. Results are JSON; \`warnings\` lists anything the user should know.`;

/** A file path, or an HTML string written to a temp file, for the publish tools. */
const source = {
  path: z.string().min(1).optional().describe('Path to the .html or .htm file (absolute, or relative to where the server runs). Its local images and videos are uploaded too.'),
  // Characters, an upper bound on bytes: refuses a huge string before it is written to disk.
  html: z.string().min(1).max(MAX_UPLOAD_BYTES).optional().describe('The page as an HTML string (up to 5 MB), instead of `path`. Cannot carry local images or videos.'),
};

class ToolError extends Error {}

type Json = Record<string, unknown> | unknown[];

function text(value: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Run one tool call with its own notice collector and return its result as
 * JSON text with the warnings and tips it raised. Failures come back as tool
 * errors, never as output on stdout (stdout is the protocol).
 */
async function respond(run: () => Promise<Json>): Promise<CallToolResult> {
  try {
    const { result, notices } = await collectNotices(run);
    const warnings = notices
      .filter((notice) => notice.level !== 'info')
      .map((notice) => (notice.level === 'tip' ? `tip: ${notice.message}` : notice.message));
    return text(Array.isArray(result) ? { items: result, warnings } : { ...result, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const limited = /quota reached|limit reached|require (Starter|Builder)/i.test(message);
    return text(limited ? `droppage: ${message.replace(/[.\s]+$/, '')}. Call get_quota to see the plan and its limits.` : `droppage: ${message}`, true);
  }
}

/** A tool call that needs the signed-in user. */
function call(run: (user: User) => Promise<Json>): Promise<CallToolResult> {
  return respond(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ToolError(NOT_SIGNED_IN);
    return run(user);
  });
}

/** The HTML file for a publish tool: `path` as is, or `html` in a fresh temp dir removed afterwards. */
async function withHtmlFile<T>(input: { path?: string; html?: string }, run: (file: string) => Promise<T>): Promise<T> {
  if ((input.path === undefined) === (input.html === undefined)) {
    throw new ToolError('pass exactly one of `path` or `html`');
  }
  if (input.path !== undefined) return run(resolve(input.path));
  if (referencesLocalMedia(input.html!)) {
    notify('warning', 'inline html cannot bring local images or videos; save the page next to them and pass its `path` instead');
  }
  const dir = await mkdtemp(join(tmpdir(), 'droppage-mcp-'));
  try {
    const file = join(dir, 'page.html');
    await writeFile(file, input.html!, { mode: 0o600 });
    return await run(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const slugFrom = (url: string) => url.slice(url.lastIndexOf('/') + 1);
const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;
const slug = z.string().min(1).describe('The page slug (the last part of its URL).');

/** The droppage MCP server: typed tools over the same services the CLI commands use. */
export function createDroppageServer(): McpServer {
  const server = new McpServer(
    { name: 'droppage', title: 'droppage', version: pkg.version },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    'publish_page',
    {
      title: 'Publish a page',
      description: 'Publish an HTML file as a NEW live link and return its URL. Use update_page to change an existing page instead.',
      inputSchema: z.object({
        ...source,
        access: z.enum(['public', 'email', 'private']).describe('public: anyone with the link (only when the user says so). email: only `emails` (Builder plan). private: only the owner.'),
        emails: z.array(z.string()).min(1).optional().describe('Who can open an email page; they enter their email at the link to get an access link. Only with access "email".'),
        expires: z.string().optional().describe('Delete the page after 30m, 12h, 7d, 2w, or on a date like 2026-12-31.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (input) =>
      call(async (user) => {
        if (input.access !== 'email' && input.emails) throw new ToolError('`emails` only goes with access "email"');
        const access = resolveAccess(user, input.access, { emails: input.emails });
        const expiresAt = input.expires ? parseExpiry(input.expires) ?? undefined : undefined;
        const { url, media } = await withHtmlFile(input, (file) =>
          publishPage({ file, user: user, access, expiresAt }),
        );
        return {
          url,
          slug: slugFrom(url),
          access_mode: access.accessMode,
          ...(access.allowedEmails && access.accessMode === 'email' ? { allowed_emails: access.allowedEmails } : {}),
          expires_at: iso(expiresAt),
          media,
        };
      }),
  );

  server.registerTool(
    'update_page',
    {
      title: 'Update a page',
      description: 'Replace the HTML behind an existing page. The URL and access settings stay; new local images and videos are uploaded and ones the page no longer uses are deleted.',
      inputSchema: z.object({
        slug,
        ...source,
        expires: z.string().optional().describe('Also set the expiry: 30m, 12h, 7d, 2w, a date, or "never".'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) =>
      call(async (user) => {
        const expiresAt = input.expires === undefined ? undefined : parseExpiry(input.expires);
        const result = await withHtmlFile(input, (file) =>
          updatePage({ slug: input.slug, file, user: user, expiresAt }),
        );
        return {
          url: result.url,
          slug: input.slug,
          media: result.media,
          removed_media: result.removed,
          ...(expiresAt !== undefined ? { expires_at: iso(expiresAt) } : {}),
        };
      }),
  );

  server.registerTool(
    'list_pages',
    {
      title: 'List pages',
      description: "The user's pages, newest first: url, access_mode, allowed_emails, view_count (unique visitors), last_viewed_at, expires_at.",
      inputSchema: z.object({
        preview: z.boolean().optional().describe('Also return a temporary preview_url per page that does not count as a view.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (input) =>
      call(async (user) => {
        const pages = await listPages(user);
        const previews = input.preview ? await fetchPreviewUrls(pages).catch(() => null) : undefined;
        if (previews === null) notify('warning', 'could not fetch preview URLs; showing pages without previews');
        return { pages: pages.map((page) => pageJson(page, previews)) };
      }),
  );

  server.registerTool(
    'delete_page',
    {
      title: 'Delete a page',
      description: 'Delete a page for good: its link stops working and its images and videos are deleted. Confirm with the user first.',
      inputSchema: z.object({ slug }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) =>
      call(async (user) => {
        const result = await deletePage(input.slug, user);
        if (!result.ok) throw new ToolError(result.message);
        return { deleted: input.slug };
      }),
  );

  server.registerTool(
    'set_page_expiry',
    {
      title: 'Set when a page expires',
      description: 'Set or clear when a page (and its images and videos) is deleted for good, without re-uploading it.',
      inputSchema: z.object({
        slug,
        when: z.string().min(1).describe('30m, 12h, 7d, 2w, a date like 2026-12-31, or "never".'),
      }),
      // A date or duration schedules a permanent deletion, so clients should ask first.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) =>
      call(async () => {
        const expiresAt = parseExpiry(input.when);
        await setPageExpiry(input.slug, expiresAt);
        return { slug: input.slug, expires_at: iso(expiresAt) };
      }),
  );

  server.registerTool(
    'get_quota',
    {
      title: 'Plan and limits',
      description: 'The plan, what it allows, and current usage. usage.level "warn" means at least 80% used; "limit" means writes may pause. Existing links stay live.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => call(async () => fetchQuota()),
  );

  server.registerTool(
    'list_recipients',
    {
      title: 'List recipients',
      description: 'Who can open an email page, with their invitation status.',
      inputSchema: z.object({
        slug,
        page: z.number().int().min(1).optional().describe('Result page, from 1.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (input) => call(async (user) => listRecipients(input.slug, user, input.page ?? 1)),
  );

  server.registerTool(
    'add_recipients',
    {
      title: 'Add recipients',
      description: 'Give more people access to an email page; each new one is emailed an invitation with an access link.',
      inputSchema: z.object({ slug, emails: z.array(z.string()).min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (input) => call(async (user) => addRecipients(input.slug, cleanEmails(input.emails), user)),
  );

  server.registerTool(
    'remove_recipient',
    {
      title: 'Remove a recipient',
      description: "Take away one person's access to an email page.",
      inputSchema: z.object({ slug, email: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) =>
      call(async (user) => {
        const [email] = cleanEmails([input.email]);
        await removeRecipient(input.slug, email, user);
        return { slug: input.slug, removed: email };
      }),
  );

  server.registerTool(
    'upload_media',
    {
      title: 'Add images or videos to a page',
      description: 'Upload image or video files to one of the user\'s pages and return their URLs, for files the HTML did not reference at publish time. PNG, JPEG, GIF, WebP, AVIF, SVG up to 4 MB; MP4, WebM up to 20 MB. Hosted media is public to anyone with its URL, even on a gated page.',
      inputSchema: z.object({
        page: z.string().min(1).describe('The page slug the files belong to; they are deleted with it.'),
        paths: z.array(z.string().min(1)).min(1).describe('Image or video file paths (absolute, or relative to where the server runs).'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (input) =>
      call(async () => {
        const uploaded = [];
        const failed = [];
        for (const path of input.paths) {
          if (!isMediaFile(path)) {
            failed.push({ file: path, error: 'not an image or video file (.png, .jpg, .gif, .webp, .avif, .svg, .mp4, .webm)' });
            continue;
          }
          try {
            uploaded.push({ file: path, ...(await uploadImage(resolve(path), input.page)) });
          } catch (err) {
            failed.push({ file: path, error: err instanceof Error ? err.message : String(err) });
          }
        }
        if (uploaded.length === 0) throw new ToolError(failed.map((f) => `${f.file}: ${f.error}`).join('; '));
        for (const f of failed) notify('warning', `not uploaded: ${f.file}: ${f.error}`);
        return { uploaded, failed };
      }),
  );

  server.registerTool(
    'list_media',
    {
      title: 'List images and videos',
      description: "The user's hosted images and videos; with `page`, only that page's and its media budget.",
      inputSchema: z.object({ page: z.string().min(1).optional() }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (input) => call(async () => listImages(input.page)),
  );

  server.registerTool(
    'delete_media',
    {
      title: 'Delete an image or video',
      description: 'Delete one hosted image or video by id or URL. It stops being served within 5 minutes.',
      inputSchema: z.object({ id_or_url: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (input) => call(async () => ({ deleted: await deleteImage(input.id_or_url) })),
  );

  server.registerTool(
    'send_feedback',
    {
      title: 'Send feedback',
      description: 'Send an idea, bug report, review, or other feedback to the droppage team. It is always marked as coming from an agent; include your model name.',
      inputSchema: z.object({
        message: z.string().trim().min(3).max(4000),
        kind: z.enum(['idea', 'bug', 'review', 'other']).optional(),
        model: z.string().trim().min(1).max(120).optional().describe('Your model name.'),
        contact: z.email().optional().describe("A reply-to email, only if the user wants one."),
        rating: z.number().int().min(1).max(5).optional().describe('1-5, only with kind "review".'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (input) =>
      respond(async () => {
          const kind = input.kind ?? 'other';
          if (input.rating !== undefined && kind !== 'review') throw new ToolError('`rating` needs kind "review"');
          // Never testimonial_consent: public quotation needs the human's own say-so.
          const { id } = await submitFeedback({
            message: input.message,
            kind,
            actor: 'agent',
            model: input.model,
            contact: input.contact?.toLowerCase(),
            rating: input.rating,
            source: 'mcp',
            cli_version: pkg.version,
          });
          return { id };
        }),
  );

  return server;
}
