import { HTTP_STATUS } from '../config/constants.js';
import { AppError, ValidationError } from '../utils/response.js';
import { activeLiveKitGateway } from './zooteer-livekit.js';
import { parseRealtimeEvent, RealtimeEvent } from './zooteer-realtime.js';
import { requireOpenActiveMember } from './zooteer-report.service.js';

/** Process-local. A second API instance does not share this window. */
export const RELAY_WINDOW_MS = 10_000;
export const RELAY_MAX = 20;

const buckets = new Map<string, number[]>();

export function resetRelayLimits(): void {
  buckets.clear();
}

function allow(userId: string, now: number): boolean {
  const recent = (buckets.get(userId) ?? []).filter((at) => now - at < RELAY_WINDOW_MS);
  if (recent.length >= RELAY_MAX) {
    buckets.set(userId, recent);
    return false;
  }
  recent.push(now);
  buckets.set(userId, recent);
  return true;
}

/**
 * Validates a client event, stamps the JWT user, and asks LiveKit to deliver it.
 * The payload is not stored and is not written to the log.
 */
export async function relayZooteerEvent(input: {
  userId: string;
  roomId: string;
  body: unknown;
  now?: number;
}): Promise<{ id: string; type: RealtimeEvent['type'] }> {
  if (!allow(input.userId, input.now ?? Date.now())) {
    throw new AppError('Too many requests', HTTP_STATUS.TOO_MANY_REQUESTS);
  }
  const event = parseRealtimeEvent(input.body);
  if ('userId' in event && event.userId !== input.userId) {
    throw new ValidationError('Sender does not match the signed-in account');
  }
  const room = await requireOpenActiveMember(input.userId, input.roomId);
  if (!room.livekitRoomName)
    throw new AppError('The media room is not ready', HTTP_STATUS.CONFLICT);
  const bytes = Buffer.from(JSON.stringify({ ...event, senderId: input.userId }));
  try {
    await activeLiveKitGateway().sendData(room.livekitRoomName, bytes);
  } catch {
    throw new AppError('LiveKit is unavailable', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
  return { id: event.id, type: event.type };
}
