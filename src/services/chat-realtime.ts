/**
 * In-process fanout for creator chat.
 *
 * No WebSocket package is installed. GET /chat/stream is a server-sent
 * event response on the existing Fastify server. Clients send messages
 * with POST. Reconnect is the browser retry plus the stream route's
 * `retry:` hint.
 *
 * ponytail: one Node process. Move this map behind Redis pub/sub if more
 * than one API instance serves chat.
 */

export type ChatRealtimeEvent =
  | {
      type: 'message';
      friendshipId: string;
      message: unknown;
    }
  | {
      type: 'read';
      friendshipId: string;
      userId: string;
      lastReadAt: string;
    };

type Sink = (event: ChatRealtimeEvent) => void;

const listeners = new Map<string, Set<Sink>>();

export function subscribeChat(userId: string, sink: Sink): () => void {
  let set = listeners.get(userId);
  if (!set) {
    set = new Set();
    listeners.set(userId, set);
  }
  set.add(sink);
  return () => {
    const current = listeners.get(userId);
    if (!current) return;
    current.delete(sink);
    if (current.size === 0) listeners.delete(userId);
  };
}

export function publishChat(userIds: string[], event: ChatRealtimeEvent): void {
  for (const userId of userIds) {
    const set = listeners.get(userId);
    if (!set) continue;
    for (const sink of set) sink(event);
  }
}

export function resetChatListeners(): void {
  listeners.clear();
}
