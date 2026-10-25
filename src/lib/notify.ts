import { AsyncLocalStorage } from 'node:async_hooks';

export type NoticeLevel = 'info' | 'warning' | 'tip';
export type Notice = { level: NoticeLevel; message: string };

const collector = new AsyncLocalStorage<(notice: Notice) => void>();

/**
 * Progress lines, tips and warnings from the services. On the CLI they go to
 * stderr as `droppage: …` lines, so stdout stays data. Inside
 * {@link collectNotices} (the MCP server, where stdout is the protocol) they are
 * collected for that call instead; each call has its own async context, so
 * concurrent tool calls never see each other's notices.
 *
 * Services must report through here, never console.error directly: a direct
 * write would bypass the collector and reach the MCP client only as log noise.
 */
export function notify(level: NoticeLevel, message: string): void {
  const collect = collector.getStore();
  if (collect) {
    collect({ level, message });
    return;
  }
  console.error(`droppage: ${level === 'info' ? '' : `${level}: `}${message}`);
}

export async function collectNotices<T>(run: () => Promise<T>): Promise<{ result: T; notices: Notice[] }> {
  const notices: Notice[] = [];
  const result = await collector.run((notice) => notices.push(notice), run);
  return { result, notices };
}
