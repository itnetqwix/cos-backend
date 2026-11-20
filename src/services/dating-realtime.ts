/**
 * In-process fanout for 420 Dating.
 *
 * No WebSocket package is installed. GET /api/v1/dating/chat/stream is a
 * server-sent event response. Clients reconnect with the `retry:` hint.
 *
 * Sinks are keyed by Ripskis user id (the JWT subject). The roadmap text
 * says profileId. One user has one dating profile, and the stream
 * authenticates the user before a profile row is required.
 *
 * Single API process only. A second Node instance does not see this map.
 * Redis is not a project dependency. Postgres LISTEN/NOTIFY is not used:
 * the configured database is reached through a pooler, and LISTEN does not
 * survive transaction-mode pooling. A shared bus needs a direct Redis (or
 * equivalent) URL, one subscriber connection per API process, and a deploy
 * that runs more than one API instance. Until that exists, run one API process.
 */

export type DatingRealtimeEvent =
  | { type: 'message'; conversationId: string; message: unknown }
  | {
      type: 'read';
      conversationId: string;
      userId: string;
      profileId: string;
      lastReadAt: string;
    }
  | { type: 'match'; match: unknown }
  | {
      type: 'like_received';
      likeId: string;
      senderProfileId: string;
      receiverProfileId: string;
    };

type Sink = (event: DatingRealtimeEvent) => void;

const listeners = new Map<string, Set<Sink>>();

export function subscribeDating(userId: string, sink: Sink): () => void {
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

export function publishDating(userIds: string[], event: DatingRealtimeEvent): void {
  for (const userId of userIds) {
    const set = listeners.get(userId);
    if (!set) continue;
    for (const sink of set) sink(event);
  }
}

export function datingSubscriberCount(userId?: string): number {
  if (userId) return listeners.get(userId)?.size ?? 0;
  let total = 0;
  for (const set of listeners.values()) total += set.size;
  return total;
}

export function resetDatingListeners(): void {
  listeners.clear();
}
