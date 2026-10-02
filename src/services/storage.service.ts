import { randomUUID } from 'node:crypto';
import {
  VIDEO_CONSTRAINTS,
  VIDEO_CONTENT_TYPE_MESSAGE,
  type AllowedVideoContentType,
} from '../config/constants.js';
import { ValidationError } from '../utils/response.js';

/**
 * Profile images reuse the same private storage adapter as contest videos.
 * No image size or dimension rule is specified in source, so the only check
 * is a displayable image content type. The bucket is not made public.
 */
export const AVATAR_CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;

export type AllowedAvatarContentType = keyof typeof AVATAR_CONTENT_TYPES;

const AVATAR_KEY_PATTERN =
  /^avatars\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|webp|gif)$/i;

/**
 * Object-storage port (M06-P02-T02).
 *
 * Contest / submission services must not import the AWS SDK.
 * Multipart / binary streaming through Fastify is forbidden (M06-P02-T05).
 */

export interface PresignedUploadRequest {
  objectKey: string;
  contentType: string;
}

export interface PresignedUploadResult {
  uploadUrl: string;
  objectKey: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
  method: 'PUT';
}

export interface StorageService {
  createPresignedUpload(request: PresignedUploadRequest): Promise<PresignedUploadResult>;
  /**
   * Temporary GET for a submission objectKey already loaded from the database.
   * Callers must not pass a client-supplied key.
   */
  createPresignedDownload?(objectKey: string): Promise<string>;
  getPublicUrl?(objectKey: string): string;
}

export interface SubmissionObjectKeyParts {
  contestId: string;
  creatorId: string;
  objectId: string;
  extension: 'mp4' | 'webm' | 'mov';
}

const OBJECT_KEY_PATTERN =
  /^contests\/([0-9a-f-]{36})\/creators\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(mp4|webm|mov)$/i;

/** Keys issued before the single-product cutover. Playback still signs these. */
const LEGACY_OBJECT_KEY_PATTERN =
  /^org\/[0-9a-f-]{36}\/contests\/([0-9a-f-]{36})\/creators\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(mp4|webm|mov)$/i;

const EXTENSION_BY_CONTENT_TYPE: Record<AllowedVideoContentType, 'mp4' | 'webm' | 'mov'> =
  {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
  };

export function extensionForContentType(contentType: string): 'mp4' | 'webm' | 'mov' {
  if (!isAllowedVideoContentType(contentType)) {
    throw new ValidationError(VIDEO_CONTENT_TYPE_MESSAGE);
  }
  return EXTENSION_BY_CONTENT_TYPE[contentType];
}

/**
 * S3 key naming.
 * Backend constructs the key. Clients cannot choose the path.
 * Pattern: contests/{contestId}/creators/{creatorId}/{uuid}.{ext}
 */
export function buildSubmissionObjectKey(parts: {
  contestId: string;
  creatorId: string;
  contentType: string;
  objectId?: string;
}): string {
  const extension = extensionForContentType(parts.contentType);
  const objectId = parts.objectId ?? randomUUID();
  return `contests/${parts.contestId}/creators/${parts.creatorId}/${objectId}.${extension}`;
}

export function parseSubmissionObjectKey(
  objectKey: string,
): SubmissionObjectKeyParts | null {
  const match =
    OBJECT_KEY_PATTERN.exec(objectKey) ?? LEGACY_OBJECT_KEY_PATTERN.exec(objectKey);
  if (!match) return null;
  return {
    contestId: match[1],
    creatorId: match[2],
    objectId: match[3],
    extension: match[4].toLowerCase() as 'mp4' | 'webm' | 'mov',
  };
}

export function isAllowedVideoContentType(
  contentType: string,
): contentType is (typeof VIDEO_CONSTRAINTS.ALLOWED_CONTENT_TYPES)[number] {
  return (VIDEO_CONSTRAINTS.ALLOWED_CONTENT_TYPES as readonly string[]).includes(
    contentType,
  );
}

export function isAllowedAvatarContentType(
  contentType: string,
): contentType is AllowedAvatarContentType {
  return Object.prototype.hasOwnProperty.call(AVATAR_CONTENT_TYPES, contentType);
}

/**
 * Backend-issued key. Clients cannot choose the path.
 * Pattern: avatars/{creatorId}/{uuid}.{ext}
 */
export function buildAvatarObjectKey(creatorId: string, contentType: string): string {
  if (!isAllowedAvatarContentType(contentType)) {
    throw new ValidationError('Profile image must be a JPEG, PNG, WebP, or GIF');
  }
  return `avatars/${creatorId}/${randomUUID()}.${AVATAR_CONTENT_TYPES[contentType]}`;
}

export function parseAvatarObjectKey(
  objectKey: string,
): { creatorId: string; objectId: string; extension: string } | null {
  const match = AVATAR_KEY_PATTERN.exec(objectKey);
  if (!match) return null;
  return {
    creatorId: match[1],
    objectId: match[2],
    extension: match[3].toLowerCase(),
  };
}

export function isSignableObjectKey(objectKey: string): boolean {
  return Boolean(parseSubmissionObjectKey(objectKey) || parseAvatarObjectKey(objectKey));
}

let activeStorage: StorageService | null = null;

export function setStorageService(storage: StorageService | null): void {
  activeStorage = storage;
}

export function getStorageService(): StorageService {
  if (!activeStorage) {
    throw new Error(
      'StorageService is not configured. Set AWS_REGION and AWS_S3_BUCKET, or inject a test adapter.',
    );
  }
  return activeStorage;
}

/**
 * Response-time playback URL. `objectKey` is the source of truth.
 * The stored `videoUrl` is only the fallback when this process has no
 * download signer.
 * Signed URLs are not written to PostgreSQL.
 * Playback TTL is `VIDEO_CONSTRAINTS.PRESIGN_EXPIRES_SECONDS` (900), the
 * same engineering default as upload presign. Source does not name a playback TTL.
 */
export async function playbackUrlForSubmission(
  objectKey: string,
  storedVideoUrl: string,
): Promise<string> {
  let storage: StorageService;
  try {
    storage = getStorageService();
  } catch {
    return storedVideoUrl;
  }
  if (!storage.createPresignedDownload || !parseSubmissionObjectKey(objectKey)) {
    return storedVideoUrl;
  }
  try {
    return await storage.createPresignedDownload(objectKey);
  } catch (error) {
    if (process.env.NODE_ENV === 'test') return storedVideoUrl;
    throw error;
  }
}

/**
 * Short-lived GET for a profile image key stored on the user.
 * Missing storage or a failed signature becomes "no image" so the feed
 * can fall back to initials. The raw key is not returned to clients.
 */
export async function signedAvatarUrl(
  objectKey: string | null | undefined,
): Promise<string | null> {
  if (!objectKey || !parseAvatarObjectKey(objectKey)) return null;
  let storage: StorageService;
  try {
    storage = getStorageService();
  } catch {
    return null;
  }
  if (!storage.createPresignedDownload) return null;
  try {
    return await storage.createPresignedDownload(objectKey);
  } catch {
    return null;
  }
}
