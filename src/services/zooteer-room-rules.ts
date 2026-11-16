import { ValidationError } from '../utils/response.js';

/**
 * PZ-M02 room bounds.
 * Capacity 2–20 and default 20 are approved.
 * Idle timeout is approved as configurable. 3600 seconds and the 60–86400
 * window are engineering bounds so a missing product duration cannot store
 * zero or an unbounded integer. They are not a product SLA.
 */
export const ZOOTEER_ROOM_LIMITS = {
  NAME_MIN: 1,
  NAME_MAX: 80,
  DESCRIPTION_MAX: 2000,
  CAPACITY_MIN: 2,
  CAPACITY_MAX: 20,
  CAPACITY_DEFAULT: 20,
  IDLE_TIMEOUT_MIN_SECONDS: 60,
  IDLE_TIMEOUT_MAX_SECONDS: 86_400,
  IDLE_TIMEOUT_DEFAULT_SECONDS: 3600,
  REASON_MAX: 500,
} as const;

export function assertRoomCapacity(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < ZOOTEER_ROOM_LIMITS.CAPACITY_MIN ||
    value > ZOOTEER_ROOM_LIMITS.CAPACITY_MAX
  ) {
    throw new ValidationError(
      `maxParticipants must be an integer from ${ZOOTEER_ROOM_LIMITS.CAPACITY_MIN} to ${ZOOTEER_ROOM_LIMITS.CAPACITY_MAX}`,
    );
  }
}

export function assertIdleTimeout(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < ZOOTEER_ROOM_LIMITS.IDLE_TIMEOUT_MIN_SECONDS ||
    value > ZOOTEER_ROOM_LIMITS.IDLE_TIMEOUT_MAX_SECONDS
  ) {
    throw new ValidationError(
      `idleTimeoutSeconds must be an integer from ${ZOOTEER_ROOM_LIMITS.IDLE_TIMEOUT_MIN_SECONDS} to ${ZOOTEER_ROOM_LIMITS.IDLE_TIMEOUT_MAX_SECONDS}`,
    );
  }
}
