import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { VIDEO_CONSTRAINTS } from '../config/constants.js';
import {
  parseSubmissionObjectKey,
  PresignedUploadRequest,
  PresignedUploadResult,
  StorageService,
} from './storage.service.js';
import { ValidationError } from '../utils/response.js';

export interface S3StorageAdapterOptions {
  region: string;
  bucket: string;
  signPutObject: (input: {
    bucket: string;
    key: string;
    contentType: string;
    expiresIn: number;
  }) => Promise<string>;
  signGetObject?: (input: {
    bucket: string;
    key: string;
    expiresIn: number;
  }) => Promise<string>;
}

/**
 * AWS S3 adapter (M06-P02-T03).
 * Signs PUT uploads only. Does not receive, stream, or buffer video bytes.
 * Does not fall back to the local filesystem.
 *
 * M12-P01-T04 posture:
 * - `PutObjectCommand` sets Bucket, Key, and ContentType only. It does not
 *   set ACL, `public-read`, or a canned policy. The application does not
 *   make objects public.
 * - The presigned URL is the only upload credential returned to the client.
 *   AWS keys stay in server env and are not part of the JSON body.
 * - Presign TTL is `VIDEO_CONSTRAINTS.PRESIGN_EXPIRES_SECONDS` (900), an
 *   engineering default. Source does not name a TTL.
 * - `getPublicUrl` builds an unsigned virtual-hosted URL stored as
 *   `videoUrl`. That value is not a playback credential. Private playback
 *   uses `createPresignedDownload` at response time.
 * - `GetObjectCommand` sets Bucket and Key only. It does not set ACL,
 *   `public-read`, or a Range header. The browser sends Range itself so
 *   S3 can answer video seeks. The signature does not include Range.
 * - Playback TTL reuses `VIDEO_CONSTRAINTS.PRESIGN_EXPIRES_SECONDS` (900).
 *   That is an engineering default. Source does not name a playback TTL.
 */
export class S3StorageAdapter implements StorageService {
  constructor(private readonly options: S3StorageAdapterOptions) {}

  static fromEnv(client?: S3Client): S3StorageAdapter {
    if (!env.AWS_REGION || !env.AWS_S3_BUCKET) {
      throw new Error(
        'AWS_REGION and AWS_S3_BUCKET are required to create presigned S3 upload URLs',
      );
    }

    const s3 =
      client ??
      new S3Client({
        region: env.AWS_REGION,
        credentials:
          env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
            ? {
                accessKeyId: env.AWS_ACCESS_KEY_ID,
                secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
              }
            : undefined,
      });

    return new S3StorageAdapter({
      region: env.AWS_REGION,
      bucket: env.AWS_S3_BUCKET,
      signPutObject: async ({ bucket, key, contentType, expiresIn }) => {
        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
        });
        return getSignedUrl(s3, command, { expiresIn });
      },
      signGetObject: async ({ bucket, key, expiresIn }) => {
        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        });
        return getSignedUrl(s3, command, { expiresIn });
      },
    });
  }

  async createPresignedUpload(
    request: PresignedUploadRequest,
  ): Promise<PresignedUploadResult> {
    const expiresInSeconds = VIDEO_CONSTRAINTS.PRESIGN_EXPIRES_SECONDS;
    const uploadUrl = await this.options.signPutObject({
      bucket: this.options.bucket,
      key: request.objectKey,
      contentType: request.contentType,
      expiresIn: expiresInSeconds,
    });

    return {
      uploadUrl,
      objectKey: request.objectKey,
      headers: { 'Content-Type': request.contentType },
      expiresInSeconds,
      method: 'PUT',
    };
  }

  async createPresignedDownload(objectKey: string): Promise<string> {
    if (!parseSubmissionObjectKey(objectKey)) {
      throw new ValidationError('objectKey is not a backend-issued submission key');
    }
    if (!this.options.signGetObject) {
      throw new Error('S3 GET signing is not configured');
    }
    return this.options.signGetObject({
      bucket: this.options.bucket,
      key: objectKey,
      expiresIn: VIDEO_CONSTRAINTS.PRESIGN_EXPIRES_SECONDS,
    });
  }

  getPublicUrl(objectKey: string): string {
    const encoded = objectKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `https://${this.options.bucket}.s3.${this.options.region}.amazonaws.com/${encoded}`;
  }
}
