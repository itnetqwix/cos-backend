import { randomUUID } from 'node:crypto';
import { VIDEO_CONSTRAINTS } from '../config/constants.js';
import { ValidationError } from '../utils/response.js';

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
  getPublicUrl?(objectKey: string): string;
}

export interface SubmissionObjectKeyParts {
  organizationId: string;
  contestId: string;
  creatorId: string;
  objectId: string;
  extension: 'mp4' | 'webm';
}

const OBJECT_KEY_PATTERN =
  /^org\/([0-9a-f-]{36})\/contests\/([0-9a-f-]{36})\/creators\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(mp4|webm)$/i;

export function extensionForContentType(contentType: string): 'mp4' | 'webm' {
  if (contentType === 'video/mp4') return 'mp4';
  if (contentType === 'video/webm') return 'webm';
  throw new ValidationError('contentType must be video/mp4 or video/webm');
}

/**
 * S3 key naming (M06 amendment).
 * Backend constructs the key. Clients cannot choose another organization's path.
 * Pattern: org/{organizationId}/contests/{contestId}/creators/{creatorId}/{uuid}.{ext}
 */
export function buildSubmissionObjectKey(parts: {
  organizationId: string;
  contestId: string;
  creatorId: string;
  contentType: string;
  objectId?: string;
}): string {
  const extension = extensionForContentType(parts.contentType);
  const objectId = parts.objectId ?? randomUUID();
  return `org/${parts.organizationId}/contests/${parts.contestId}/creators/${parts.creatorId}/${objectId}.${extension}`;
}

export function parseSubmissionObjectKey(
  objectKey: string,
): SubmissionObjectKeyParts | null {
  const match = OBJECT_KEY_PATTERN.exec(objectKey);
  if (!match) return null;
  return {
    organizationId: match[1],
    contestId: match[2],
    creatorId: match[3],
    objectId: match[4],
    extension: match[5].toLowerCase() as 'mp4' | 'webm',
  };
}

export function isAllowedVideoContentType(
  contentType: string,
): contentType is (typeof VIDEO_CONSTRAINTS.ALLOWED_CONTENT_TYPES)[number] {
  return (VIDEO_CONSTRAINTS.ALLOWED_CONTENT_TYPES as readonly string[]).includes(
    contentType,
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
