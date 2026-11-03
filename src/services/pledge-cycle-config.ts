import { VIDEO_CONSTRAINTS } from '../config/constants.js';
import { ValidationError } from '../utils/response.js';

/**
 * Admin-supplied Pledge cycle settings.
 * Size and duration ceilings are the platform video rules. They are not
 * Pledge defaults. A month stores the values Admin chose for that month.
 */

export const PLEDGE_PLATFORM_FORMATS = VIDEO_CONSTRAINTS.ALLOWED_CONTENT_TYPES;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface PledgeCycleSettings {
  winnerCount: number;
  maxVideoSizeMb: number;
  maxVideoDurationSeconds: number;
  allowedVideoFormats: string[];
}

export function assertPositiveWinnerCount(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new ValidationError('winnerCount must be a positive integer');
  }
  return value;
}

export function assertPledgeUploadSettings(input: {
  maxVideoSizeMb: number;
  maxVideoDurationSeconds: number;
  allowedVideoFormats?: string[] | null;
}): {
  maxVideoSizeMb: number;
  maxVideoDurationSeconds: number;
  allowedVideoFormats: string[];
} {
  const maxMb = VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES / (1024 * 1024);
  if (
    !Number.isInteger(input.maxVideoSizeMb) ||
    input.maxVideoSizeMb < 1 ||
    input.maxVideoSizeMb > maxMb
  ) {
    throw new ValidationError(
      `maxVideoSizeMb must be a positive integer no greater than ${maxMb}`,
    );
  }
  if (
    !Number.isInteger(input.maxVideoDurationSeconds) ||
    input.maxVideoDurationSeconds < VIDEO_CONSTRAINTS.MIN_DURATION_SECONDS ||
    input.maxVideoDurationSeconds > VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS
  ) {
    throw new ValidationError(
      `maxVideoDurationSeconds must be a positive integer no greater than ${VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS}`,
    );
  }
  return {
    maxVideoSizeMb: input.maxVideoSizeMb,
    maxVideoDurationSeconds: input.maxVideoDurationSeconds,
    allowedVideoFormats: parseAllowedFormats(input.allowedVideoFormats),
  };
}

export function parseAllowedFormats(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [...PLEDGE_PLATFORM_FORMATS];
  const allowed = new Set<string>(PLEDGE_PLATFORM_FORMATS);
  const formats: string[] = [];
  for (const item of source) {
    if (typeof item !== 'string' || !allowed.has(item) || formats.includes(item)) {
      throw new ValidationError(
        'allowedVideoFormats must be a subset of video/mp4, video/webm, and video/quicktime',
      );
    }
    formats.push(item);
  }
  if (formats.length === 0) {
    throw new ValidationError('At least one video format is required');
  }
  return formats;
}

export function readStoredFormats(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const allowed = new Set<string>(PLEDGE_PLATFORM_FORMATS);
  const formats = value.filter(
    (item): item is string => typeof item === 'string' && allowed.has(item),
  );
  return formats.length > 0 ? [...new Set(formats)] : null;
}

export function cycleMonthName(cycleMonth: string | null | undefined): string {
  if (!cycleMonth) return 'this month';
  const month = Number(cycleMonth.slice(5, 7));
  return MONTH_NAMES[month - 1] ?? cycleMonth;
}

export function formatRating(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function nonWinnerResultMessage(
  _cycleMonth: string | null,
  _overallRating: number,
): string {
  return "Unfortunately, you weren't among this month's winners. Thank you for participating!";
}

export function insufficientResultMessage(_cycleMonth: string | null): string {
  return "Unfortunately, you weren't among this month's winners. Thank you for participating!";
}

export type PledgeConfigPhase =
  'template' | 'upcoming' | 'active-frozen' | 'published-historical';

export interface PledgeUploadCandidate {
  id?: string;
  cycleMonth?: string | null;
  seriesSlug?: string | null;
  maxVideoSizeMb?: number | null;
  maxVideoDurationSeconds?: number | null;
  allowedVideoFormats?: unknown;
}

export interface ResolvedPledgeUploadConfig {
  maxVideoSizeMb: number;
  maxVideoDurationSeconds: number;
  allowedVideoFormats: string[];
  isInherited: boolean;
  isDefault?: boolean;
  sourceCycleMonth?: string | null;
}

/**
 * Checks whether an entity has explicit, complete, valid upload configuration.
 */
export function hasValidUploadConfig(candidate: {
  maxVideoSizeMb?: number | null;
  maxVideoDurationSeconds?: number | null;
  allowedVideoFormats?: unknown;
}): boolean {
  if (
    typeof candidate.maxVideoSizeMb !== 'number' ||
    !Number.isInteger(candidate.maxVideoSizeMb) ||
    candidate.maxVideoSizeMb < 1 ||
    typeof candidate.maxVideoDurationSeconds !== 'number' ||
    !Number.isInteger(candidate.maxVideoDurationSeconds) ||
    candidate.maxVideoDurationSeconds < 1
  ) {
    return false;
  }
  const formats = readStoredFormats(candidate.allowedVideoFormats);
  return formats !== null && formats.length > 0;
}

/**
 * Resolves the authoritative upload configuration for a Pledge month.
 * Priority:
 * 1. Explicitly configured upload settings on the target cycle.
 * 2. Inherited settings from the latest chronological preceding monthly cycle.
 * 3. Fallback to permanent template upload settings (cycleMonth == null).
 * 4. Fallback to platform defaults (100 MB, 60s, MP4/WebM/QuickTime) if allowPlatformDefaults is true.
 * 5. Returns null if no valid configuration exists anywhere in the chain and allowPlatformDefaults is false.
 */
export function resolvePledgeUploadConfig(
  target: PledgeUploadCandidate,
  previousCycles: PledgeUploadCandidate[] = [],
  template: PledgeUploadCandidate | null = null,
  options: { allowPlatformDefaults?: boolean } = {},
): ResolvedPledgeUploadConfig | null {
  // 1. Explicit configuration on the target cycle takes highest priority
  if (hasValidUploadConfig(target)) {
    const formats = readStoredFormats(target.allowedVideoFormats) ?? [
      ...PLEDGE_PLATFORM_FORMATS,
    ];
    return {
      maxVideoSizeMb: target.maxVideoSizeMb!,
      maxVideoDurationSeconds: target.maxVideoDurationSeconds!,
      allowedVideoFormats: formats,
      isInherited: false,
      isDefault: false,
      sourceCycleMonth: target.cycleMonth,
    };
  }

  // 2. If target is a monthly cycle, find latest chronological predecessor with valid config
  if (target.cycleMonth) {
    const targetMonth = target.cycleMonth;
    const candidates = previousCycles
      .filter(
        (c) => c.cycleMonth && c.cycleMonth < targetMonth && hasValidUploadConfig(c),
      )
      .sort((a, b) => (b.cycleMonth ?? '').localeCompare(a.cycleMonth ?? ''));

    if (candidates.length > 0) {
      const best = candidates[0]!;
      const formats = readStoredFormats(best.allowedVideoFormats) ?? [
        ...PLEDGE_PLATFORM_FORMATS,
      ];
      return {
        maxVideoSizeMb: best.maxVideoSizeMb!,
        maxVideoDurationSeconds: best.maxVideoDurationSeconds!,
        allowedVideoFormats: formats,
        isInherited: true,
        isDefault: false,
        sourceCycleMonth: best.cycleMonth,
      };
    }
  }

  // 3. Fallback to template if template has valid upload configuration
  if (template && hasValidUploadConfig(template)) {
    const formats = readStoredFormats(template.allowedVideoFormats) ?? [
      ...PLEDGE_PLATFORM_FORMATS,
    ];
    return {
      maxVideoSizeMb: template.maxVideoSizeMb!,
      maxVideoDurationSeconds: template.maxVideoDurationSeconds!,
      allowedVideoFormats: formats,
      isInherited: true,
      isDefault: false,
      sourceCycleMonth: null,
    };
  }

  // 4. Platform defaults (when allowPlatformDefaults is true)
  if (options.allowPlatformDefaults) {
    return {
      maxVideoSizeMb: Math.floor(VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES / (1024 * 1024)),
      maxVideoDurationSeconds: VIDEO_CONSTRAINTS.MAX_DURATION_SECONDS,
      allowedVideoFormats: [...PLEDGE_PLATFORM_FORMATS],
      isInherited: true,
      isDefault: true,
      sourceCycleMonth: 'platform-default',
    };
  }

  // 5. No valid configuration resolved
  return null;
}

export function assertResolvedPledgeUploadConfig(
  target: PledgeUploadCandidate,
  previousCycles: PledgeUploadCandidate[] = [],
  template: PledgeUploadCandidate | null = null,
  options: { allowPlatformDefaults?: boolean } = {},
): ResolvedPledgeUploadConfig {
  const resolved = resolvePledgeUploadConfig(target, previousCycles, template, options);
  if (!resolved) {
    throw new ValidationError(
      'This Pledge month has no upload configuration. An administrator must configure video upload limits in Competition Settings.',
    );
  }
  return resolved;
}

export function pledgeConfigPhase(input: {
  cycleMonth: string | null;
  status: string;
  winnersPublished: boolean;
  now?: Date;
}): PledgeConfigPhase {
  if (!input.cycleMonth) return 'template';
  if (
    input.winnersPublished ||
    input.status === 'COMPLETED' ||
    input.status === 'ARCHIVED'
  ) {
    return 'published-historical';
  }
  const now = input.now ?? new Date();
  const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  if (
    input.cycleMonth > current ||
    input.status === 'SCHEDULED' ||
    input.status === 'DRAFT'
  ) {
    return 'upcoming';
  }
  return 'active-frozen';
}
