/**
 * Distinct people who occupy a seat: active participant user ids plus the host.
 * The host is inserted into the set, so a host participant row is not a second seat.
 */
export function seatHolders(
  hostId: string,
  activeUserIds: readonly string[],
): Set<string> {
  const seats = new Set(activeUserIds);
  seats.add(hostId);
  return seats;
}

/** Distinct ACTIVE user ids plus the host, once. Used by list, detail, and admission. */
export function occupiedSeatCount(
  hostId: string,
  activeUserIds: readonly string[],
): number {
  return seatHolders(hostId, activeUserIds).size;
}

/** True when admitting joiningUserId would put a new person over maxParticipants. */
export function admissionWouldExceedCapacity(
  hostId: string,
  activeUserIds: readonly string[],
  joiningUserId: string,
  maxParticipants: number,
): boolean {
  const seats = seatHolders(hostId, activeUserIds);
  if (seats.has(joiningUserId)) return false;
  return seats.size + 1 > maxParticipants;
}
