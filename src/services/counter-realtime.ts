import type { CounterSnapshot } from './counter.service.js';

/**
 * In-process fanout for the public counter.
 *
 * No WebSocket package is installed. GET /counter/stream is server-sent
 * events, same transport as creator chat. Reconnect is the browser retry
 * plus the `retry:` hint. A client that cannot keep the stream polls
 * GET /counter.
 *
 * ponytail: one Node process. Move this set behind Redis pub/sub if more
 * than one API instance serves the stream.
 */

type Sink = (snapshot: CounterSnapshot) => void;

const listeners = new Set<Sink>();
let timer: ReturnType<typeof setInterval> | null = null;

export function subscribeCounter(sink: Sink): () => void {
  listeners.add(sink);
  return () => {
    listeners.delete(sink);
  };
}

export function publishCounter(snapshot: CounterSnapshot): void {
  for (const sink of listeners) sink(snapshot);
}

export function counterStreamPrelude(snapshot: CounterSnapshot): string {
  return `retry: 3000\n\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
}

export function counterStreamEvent(snapshot: CounterSnapshot): string {
  return `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
}

export function ensureCounterTicker(read: () => Promise<CounterSnapshot>): void {
  if (timer) return;
  timer = setInterval(() => {
    if (listeners.size === 0) return;
    void read()
      .then(publishCounter)
      .catch(() => undefined);
  }, 1000);
  timer.unref();
}

export function resetCounterListeners(): void {
  listeners.clear();
  if (timer) clearInterval(timer);
  timer = null;
}
