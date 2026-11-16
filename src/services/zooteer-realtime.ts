import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ValidationError } from '../utils/response.js';

/** LiveKit data-channel contract. The API does not relay these packets. */
export const REALTIME_VERSION = 1;
export const MAX_CHAT_CHARS = 1000;
export const MAX_EVENT_BYTES = 2048;

export const STANDARD_EMOJI = [
  '👍',
  '👎',
  '❤️',
  '😂',
  '😮',
  '😢',
  '🔥',
  '👏',
  '🎉',
  '✅',
  '❌',
  '👀',
  '💯',
  '🙌',
] as const;

const uuid = z.string().uuid();

const chatEvent = z
  .object({
    v: z.literal(REALTIME_VERSION),
    type: z.literal('chat.message'),
    id: uuid,
    text: z.string(),
  })
  .strict();

const reactionAdd = z
  .object({
    v: z.literal(REALTIME_VERSION),
    type: z.literal('reaction.add'),
    id: uuid,
    emoji: z.string(),
    targetEventId: uuid.optional(),
  })
  .strict();

const reactionRemove = z
  .object({
    v: z.literal(REALTIME_VERSION),
    type: z.literal('reaction.remove'),
    id: uuid,
    emoji: z.string(),
    targetEventId: uuid,
  })
  .strict();

const presence = z
  .object({
    v: z.literal(REALTIME_VERSION),
    type: z.enum(['participant.joined', 'participant.left', 'participant.reconnected']),
    id: uuid,
    userId: uuid,
  })
  .strict();

const roomClosed = z
  .object({
    v: z.literal(REALTIME_VERSION),
    type: z.literal('room.closed'),
    id: uuid,
  })
  .strict();

export type RealtimeEvent =
  | z.infer<typeof chatEvent>
  | z.infer<typeof reactionAdd>
  | z.infer<typeof reactionRemove>
  | z.infer<typeof presence>
  | z.infer<typeof roomClosed>;

function reject(message: string): never {
  throw new ValidationError(message);
}

function assertBytes(value: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (bytes > MAX_EVENT_BYTES) reject('Realtime event is too large');
}

function assertText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) reject('Chat message is empty');
  if ([...trimmed].length > MAX_CHAT_CHARS) reject('Chat message is too long');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(trimmed)) {
    reject('Chat message contains unsupported characters');
  }
  return trimmed;
}

function assertEmoji(emoji: string): void {
  if (!STANDARD_EMOJI.includes(emoji as (typeof STANDARD_EMOJI)[number])) {
    reject('Emoji is not allowed');
  }
}

/** Validates a data-channel payload. Does not store it. */
export function parseRealtimeEvent(input: unknown): RealtimeEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    reject('Realtime event is invalid');
  assertBytes(input);
  const type = (input as { type?: unknown }).type;
  if (type === 'chat.message') {
    const parsed = chatEvent.safeParse(input);
    if (!parsed.success) reject('Realtime event is invalid');
    return { ...parsed.data, text: assertText(parsed.data.text) };
  }
  if (type === 'reaction.add' || type === 'reaction.remove') {
    const parsed = (type === 'reaction.add' ? reactionAdd : reactionRemove).safeParse(
      input,
    );
    if (!parsed.success) reject('Realtime event is invalid');
    assertEmoji(parsed.data.emoji);
    return parsed.data;
  }
  if (
    type === 'participant.joined' ||
    type === 'participant.left' ||
    type === 'participant.reconnected'
  ) {
    const parsed = presence.safeParse(input);
    if (!parsed.success) reject('Realtime event is invalid');
    return parsed.data;
  }
  if (type === 'room.closed') {
    const parsed = roomClosed.safeParse(input);
    if (!parsed.success) reject('Realtime event is invalid');
    return parsed.data;
  }
  reject('Realtime event is invalid');
}

export function realtimeContract() {
  return {
    version: REALTIME_VERSION,
    transport: 'server-relay' as const,
    maxTextLength: MAX_CHAT_CHARS,
    maxEventBytes: MAX_EVENT_BYTES,
    emoji: [...STANDARD_EMOJI],
    events: [
      'chat.message',
      'reaction.add',
      'reaction.remove',
      'participant.joined',
      'participant.left',
      'participant.reconnected',
      'room.closed',
    ],
    sender: 'livekit-participant-identity',
    history: false,
  };
}

export function newEventId(): string {
  return randomUUID();
}
