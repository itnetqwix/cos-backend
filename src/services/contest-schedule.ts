import { ValidationError } from '../utils/response.js';

/**
 * Contest schedule instants are absolute timestamps.
 * `timezone` is the IANA zone the admin used when entering wall-clock times.
 * Offsets are resolved with Intl so daylight-saving transitions are included.
 * Fixed UTC offsets are not added or subtracted by hand.
 */

export const DEFAULT_CONTEST_TIMEZONE = 'Asia/Kolkata';

export const SUBMISSION_DEADLINE_AFTER_OPENING =
  'Submission deadline must be after submission opening.';

export const VOTING_CLOSURE_AFTER_DEADLINE =
  'Voting closure must be after the submission deadline.';

export function isValidIanaTimeZone(timeZone: string): boolean {
  const trimmed = timeZone.trim();
  if (!trimmed || trimmed.length > 100) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function readZonedParts(date: Date, timeZone: string): WallParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = readZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - date.getTime();
}

/**
 * Interpret `YYYY-MM-DDTHH:mm` as a wall clock in `timeZone`.
 * Returns null when the zone is invalid or the wall time falls in a DST gap.
 */
export function zonedWallTimeToUtc(wall: string, timeZone: string): Date | null {
  if (!isValidIanaTimeZone(timeZone)) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    wall.trim(),
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = utcGuess - offsetMs(new Date(utcGuess), timeZone);
  const adjusted = utcGuess - offsetMs(new Date(utc), timeZone);
  if (adjusted !== utc) utc = adjusted;

  const result = new Date(utc);
  const back = readZonedParts(result, timeZone);
  if (
    back.year !== year ||
    back.month !== month ||
    back.day !== day ||
    back.hour !== hour ||
    back.minute !== minute ||
    back.second !== second
  ) {
    return null;
  }
  return result;
}

/** Format an absolute instant as `YYYY-MM-DDTHH:mm` in the contest timezone. */
export function utcToZonedWallTime(instant: Date, timeZone: string): string | null {
  if (!isValidIanaTimeZone(timeZone) || Number.isNaN(instant.getTime())) return null;
  const parts = readZonedParts(instant, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Calendar date of `now` in `timeZone`, at 00:00 wall time. */
export function todayDateTimeLocal(timeZone: string, now = new Date()): string {
  const zone = isValidIanaTimeZone(timeZone) ? timeZone : DEFAULT_CONTEST_TIMEZONE;
  const parts = readZonedParts(now, zone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T00:00`;
}

export function assertChronologicalSchedule(input: {
  submissionOpenAt: Date;
  submissionDeadlineAt: Date;
  votingClosesAt?: Date | null;
}): void {
  if (
    Number.isNaN(input.submissionOpenAt.getTime()) ||
    Number.isNaN(input.submissionDeadlineAt.getTime())
  ) {
    throw new ValidationError('Contest schedule must use valid date-times');
  }
  if (input.submissionDeadlineAt.getTime() <= input.submissionOpenAt.getTime()) {
    throw new ValidationError(SUBMISSION_DEADLINE_AFTER_OPENING);
  }
  if (input.votingClosesAt) {
    if (Number.isNaN(input.votingClosesAt.getTime())) {
      throw new ValidationError('Contest schedule must use valid date-times');
    }
    if (input.votingClosesAt.getTime() <= input.submissionDeadlineAt.getTime()) {
      throw new ValidationError(VOTING_CLOSURE_AFTER_DEADLINE);
    }
  }
}
