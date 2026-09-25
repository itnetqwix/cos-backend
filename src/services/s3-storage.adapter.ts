import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { VIDEO_CONSTRAINTS } from '../config/constants.js';
import {
  PresignedUploadRequest,
  PresignedUploadResult,
  StorageService,
} from './storage.service.js';

export interface S3StorageAdapterOptions {
  region: string;
  bucket: string;
  signPutObject: (input: {
    bucket: string;
    key: string;
    contentType: string;
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
 *   `videoUrl`. It does not sign a GET and does not change object ACL.
 *   Whether that URL can be fetched depends on bucket policy outside this
 *   repository. Bucket CORS for browser PUT, Block Public Access, and a
 *   signed-GET playback URL are NOT SPECIFIED here (no IaC in this repo).
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

  getPublicUrl(objectKey: string): string {
    const encoded = objectKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `https://${this.options.bucket}.s3.${this.options.region}.amazonaws.com/${encoded}`;
  }
}
