import { randomUUID } from 'node:crypto';
import {
  VIDEO_CONSTRAINTS,
  VIDEO_CONTENT_TYPE_MESSAGE,
  type AllowedVideoContentType,
} from '../config/constants.js';
import { env } from '../config/env.js';
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
 * Contest banners reuse the avatar image types and the private bucket.
 * No separate image-size rule is specified, so the existing media ceiling
 * (`VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES`, 100MB) is the size limit.
 */
export const BANNER_CONTENT_TYPES = AVATAR_CONTENT_TYPES;

export type AllowedBannerContentType = AllowedAvatarContentType;

const BANNER_KEY_PATTERN =
  /^contest-banners\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|webp|gif)$/i;

/**
 * Private chat objects. The bucket stays private. Clients receive a presigned
 * PUT, then a presigned GET. A public CDN URL is not issued for these keys.
 * Pattern: chat/{friendshipId}/{senderId}/{uuid}.{ext}
 */
const CHAT_KEY_PATTERN =
  /^chat\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|webp|gif|mp4|webm|mov)$/i;

export const CHAT_ATTACHMENT_CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
} as const;

export type AllowedChatContentType = keyof typeof CHAT_ATTACHMENT_CONTENT_TYPES;

export function isAllowedChatContentType(
  contentType: string,
): contentType is AllowedChatContentType {
  return Object.prototype.hasOwnProperty.call(CHAT_ATTACHMENT_CONTENT_TYPES, contentType);
}

export function chatAttachmentKind(
  contentType: AllowedChatContentType,
): 'IMAGE' | 'VIDEO' {
  return contentType.startsWith('image/') ? 'IMAGE' : 'VIDEO';
}

export function buildChatAttachmentKey(parts: {
  friendshipId: string;
  senderId: string;
  contentType: string;
  objectId?: string;
}): string {
  if (!isAllowedChatContentType(parts.contentType)) {
    throw new ValidationError(
      'Attachment must be a JPEG, PNG, WebP, GIF, MP4, WebM, or MOV',
    );
  }
  const objectId = parts.objectId ?? randomUUID();
  const extension = CHAT_ATTACHMENT_CONTENT_TYPES[parts.contentType];
  return `chat/${parts.friendshipId}/${parts.senderId}/${objectId}.${extension}`;
}

export function parseChatAttachmentKey(objectKey: string): {
  friendshipId: string;
  senderId: string;
  objectId: string;
  extension: string;
} | null {
  const match = CHAT_KEY_PATTERN.exec(objectKey);
  if (!match) return null;
  return {
    friendshipId: match[1],
    senderId: match[2],
    objectId: match[3],
    extension: match[4].toLowerCase(),
  };
}

/**
 * Object-storage port (M06-P02-T02).
 *
 * Contest / submission services must not import the AWS SDK.
 * Multipart / binary streaming through Fastify is forbidden (M06-P02-T05).
 */

export interface PresignedUploadRequest {
  objectKey: string;
  contentType: string;
  /** When set, the signed PUT is bound to this byte length. */
  contentLength?: number;
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

/**
 * Poster frame captured by the browser at upload time.
 * Same path and object id as the video, with a .jpg extension.
 * Pattern: contests/{contestId}/creators/{creatorId}/{uuid}.jpg
 */
export const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';

const THUMBNAIL_KEY_PATTERN =
  /^contests\/([0-9a-f-]{36})\/creators\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.jpg$/i;

export function parseThumbnailObjectKey(
  objectKey: string,
): { contestId: string; creatorId: string; objectId: string } | null {
  const match = THUMBNAIL_KEY_PATTERN.exec(objectKey);
  if (!match) return null;
  return { contestId: match[1], creatorId: match[2], objectId: match[3] };
}

/** Thumbnail key paired with a current-format video key. Legacy keys get none. */
export function thumbnailKeyForSubmission(videoObjectKey: string): string | null {
  if (!OBJECT_KEY_PATTERN.test(videoObjectKey)) return null;
  return videoObjectKey.replace(/\.(mp4|webm|mov)$/i, '.jpg');
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

/**
 * Backend-issued key. Clients cannot choose the path.
 * Pattern: contest-banners/{adminId}/{uuid}.{ext}
 */
export function buildBannerObjectKey(adminId: string, contentType: string): string {
  if (!isAllowedAvatarContentType(contentType)) {
    throw new ValidationError('Contest banner must be a JPEG, PNG, WebP, or GIF');
  }
  return `contest-banners/${adminId}/${randomUUID()}.${AVATAR_CONTENT_TYPES[contentType]}`;
}

export function parseBannerObjectKey(
  objectKey: string,
): { adminId: string; objectId: string; extension: string } | null {
  const match = BANNER_KEY_PATTERN.exec(objectKey);
  if (!match) return null;
  return {
    adminId: match[1],
    objectId: match[2],
    extension: match[3].toLowerCase(),
  };
}

export function isSignableObjectKey(objectKey: string): boolean {
  return Boolean(
    parseSubmissionObjectKey(objectKey) ||
    parseThumbnailObjectKey(objectKey) ||
    parseAvatarObjectKey(objectKey) ||
    parseBannerObjectKey(objectKey) ||
    parseChatAttachmentKey(objectKey),
  );
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
 * Browser and Cloudflare cache header for an immutable approved video object.
 * The media worker sets this. Fastify does not apply it to API JSON.
 * Pending and rejected objects do not receive a public CDN URL.
 */
export const PUBLIC_MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export type PlaybackAudience = 'public' | 'restricted';

/**
 * Stable CDN identity for one immutable object key.
 * No signature, expiry, or cache-buster query is added.
 * Returns null unless the base is https and the key is a backend-issued
 * video or thumbnail key.
 */
export function buildPublicCdnMediaUrl(
  cdnBaseUrl: string,
  objectKey: string,
): string | null {
  if (!parseSubmissionObjectKey(objectKey) && !parseThumbnailObjectKey(objectKey)) {
    return null;
  }
  const trimmed = cdnBaseUrl.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  const prefix = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  const encoded = objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${prefix}/v1/${encoded}`;
}

/**
 * Response-time playback URL. `objectKey` is the source of truth.
 * The stored `videoUrl` is only the fallback when this process has no
 * download signer.
 * Signed URLs are not written to PostgreSQL.
 * Playback TTL is `VIDEO_CONSTRAINTS.PRESIGN_EXPIRES_SECONDS` (900), the
 * same engineering default as upload presign. Source does not name a playback TTL.
 *
 * `audience: "public"` is approved judging and leaderboard playback only.
 * When `MEDIA_CDN_BASE_URL` is set, that audience gets one stable CDN URL.
 * Restricted caller paths keep a presigned GET so pending and rejected
 * objects are not published on the media hostname.
 */
export async function playbackUrlForSubmission(
  objectKey: string,
  storedVideoUrl: string,
  options?: { audience?: PlaybackAudience; cdnBaseUrl?: string | null },
): Promise<string> {
  const audience = options?.audience ?? 'restricted';
  const cdnBase =
    options?.cdnBaseUrl === undefined ? env.MEDIA_CDN_BASE_URL : options.cdnBaseUrl;
  if (audience === 'public' && cdnBase) {
    const cdnUrl = buildPublicCdnMediaUrl(cdnBase, objectKey);
    if (cdnUrl) return cdnUrl;
  }

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
async function signedObjectUrl(
  objectKey: string | null | undefined,
  matches: (key: string) => boolean,
): Promise<string | null> {
  if (!objectKey || !matches(objectKey)) return null;
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

export async function signedAvatarUrl(
  objectKey: string | null | undefined,
): Promise<string | null> {
  return signedObjectUrl(objectKey, (key) => Boolean(parseAvatarObjectKey(key)));
}

/**
 * Short-lived GET for a contest banner key. The raw key is stored on the
 * contest. A missing signer falls back to the legacy banner URL, never to
 * the object key itself.
 */
export async function signedBannerUrl(
  objectKey: string | null | undefined,
): Promise<string | null> {
  return signedObjectUrl(objectKey, (key) => Boolean(parseBannerObjectKey(key)));
}

export async function resolveContestBannerUrl(
  objectKey: string | null | undefined,
  legacyBannerUrl: string | null | undefined,
): Promise<string | null> {
  if (objectKey && parseBannerObjectKey(objectKey)) {
    return signedBannerUrl(objectKey);
  }
  const legacy = legacyBannerUrl?.trim();
  return legacy ? legacy : null;
}

/**
 * Stored poster when it is already an http(s) URL.
 * A captured thumbnail key gets the stable CDN URL for the public audience
 * (approved judging, leaderboard, share preview) when `MEDIA_CDN_BASE_URL`
 * is set, otherwise a short-lived download URL.
 * Other private object keys are exchanged for a short-lived download URL.
 * Anything else becomes null so the client can show a fallback
 * without requesting a thumbnail per row or exposing a raw key.
 */
export async function resolveThumbnailUrl(
  value: string | null | undefined,
  options?: { audience?: PlaybackAudience },
): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (parseThumbnailObjectKey(value)) {
    if (options?.audience === 'public' && env.MEDIA_CDN_BASE_URL) {
      const cdnUrl = buildPublicCdnMediaUrl(env.MEDIA_CDN_BASE_URL, value);
      if (cdnUrl) return cdnUrl;
    }
    return signedObjectUrl(value, (key) => Boolean(parseThumbnailObjectKey(key)));
  }
  if (!isSignableObjectKey(value)) return null;
  try {
    const signed = await playbackUrlForSubmission(value, value);
    return /^https?:\/\//i.test(signed) ? signed : null;
  } catch {
    return null;
  }
}
