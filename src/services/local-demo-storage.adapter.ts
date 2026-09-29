import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { VIDEO_CONSTRAINTS } from '../config/constants.js';
import { ValidationError } from '../utils/response.js';
import {
  parseSubmissionObjectKey,
  PresignedUploadRequest,
  PresignedUploadResult,
  StorageService,
} from './storage.service.js';

/**
 * TEMPORARY LOCAL CLIENT DEMO MODE.
 *
 * Production storage remains `S3StorageAdapter`. This adapter is selected
 * only when `STORAGE_PROVIDER=local-demo`. It does not run for `s3`.
 *
 * Video bytes are accepted by a standalone Node HTTP server, not by Fastify.
 * The submission service still presigns, and the browser still PUTs the file
 * to the returned URL, then calls the existing complete route.
 */

export interface LocalDemoStorageOptions {
  rootDir: string;
  host: string;
  port: number;
  signingSecret: string;
}

class DemoMediaError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

class ByteCap extends Transform {
  seen = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.seen += chunk.length;
    if (this.seen > this.maxBytes) {
      callback(new DemoMediaError('Video exceeds the 100MB limit', 413));
      return;
    }
    callback(null, chunk);
  }
}

export function demoStorageRoot(): string {
  return path.resolve(fileURLToPath(new URL('../../storage/demo', import.meta.url)));
}

function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function contentTypeForKey(objectKey: string): string {
  return objectKey.endsWith('.webm') ? 'video/webm' : 'video/mp4';
}

export class LocalDemoStorageAdapter implements StorageService {
  private server: http.Server | null = null;
  private origin: string;

  constructor(private readonly options: LocalDemoStorageOptions) {
    this.origin = `http://${options.host}:${options.port}`;
  }

  static fromEnv(): LocalDemoStorageAdapter {
    if (!env.JWT_SECRET) {
      throw new Error('JWT_SECRET is required to sign local demo upload URLs');
    }
    return new LocalDemoStorageAdapter({
      rootDir: demoStorageRoot(),
      host: '127.0.0.1',
      port: env.DEMO_MEDIA_PORT,
      signingSecret: env.JWT_SECRET,
    });
  }

  get listeningOrigin(): string {
    return this.origin;
  }

  async start(): Promise<void> {
    if (this.server) return;
    await mkdir(this.options.rootDir, { recursive: true });
    await mkdir(path.join(this.options.rootDir, 'samples'), { recursive: true });

    const server = http.createServer((req, res) => {
      void this.handle(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port, this.options.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    const address = server.address();
    if (address && typeof address === 'object') {
      this.origin = `http://${this.options.host}:${address.port}`;
    }
    this.server = server;
    console.info(
      `TEMPORARY LOCAL CLIENT DEMO media at ${this.origin} (files in ${this.options.rootDir})`,
    );
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async createPresignedUpload(
    request: PresignedUploadRequest,
  ): Promise<PresignedUploadResult> {
    if (!parseSubmissionObjectKey(request.objectKey)) {
      throw new ValidationError('objectKey is not a backend-issued submission key');
    }
    if (request.contentType !== 'video/mp4' && request.contentType !== 'video/webm') {
      throw new ValidationError('contentType must be video/mp4 or video/webm');
    }

    const expiresInSeconds = VIDEO_CONSTRAINTS.PRESIGN_EXPIRES_SECONDS;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const expires = String(expiresAt);
    const token = this.sign(
      `put\n${request.objectKey}\n${request.contentType}\n${expires}`,
    );
    const params = new URLSearchParams({
      key: request.objectKey,
      contentType: request.contentType,
      expires,
      token,
    });

    return {
      uploadUrl: `${this.origin}/upload?${params.toString()}`,
      objectKey: request.objectKey,
      headers: { 'Content-Type': request.contentType },
      expiresInSeconds,
      method: 'PUT',
    };
  }

  getPublicUrl(objectKey: string): string {
    const token = this.sign(`get\n${objectKey}`);
    const params = new URLSearchParams({ key: objectKey, token });
    return `${this.origin}/media?${params.toString()}`;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.options.signingSecret).update(payload).digest('hex');
  }

  private resolveObjectPath(objectKey: string): string {
    const parsed = parseSubmissionObjectKey(objectKey);
    if (!parsed) {
      throw new DemoMediaError('Upload key is not a submission object', 400);
    }
    const parts = objectKey.split('/');
    if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
      throw new DemoMediaError('Upload key is not a submission object', 400);
    }
    const resolved = path.resolve(this.options.rootDir, ...parts);
    const root = path.resolve(this.options.rootDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new DemoMediaError('Upload key is not a submission object', 400);
    }
    return resolved;
  }

  private applyCors(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Accept-Ranges, Content-Range, Content-Length',
    );
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  private sendText(res: http.ServerResponse, statusCode: number, message: string): void {
    if (res.headersSent) return;
    this.applyCors(res);
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(message);
  }

  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', this.origin);
      if (
        req.method === 'OPTIONS' &&
        (url.pathname === '/upload' || url.pathname === '/media')
      ) {
        this.applyCors(res);
        res.statusCode = 204;
        res.end();
        return;
      }
      if (url.pathname === '/upload') {
        await this.handleUpload(req, res, url);
        return;
      }
      if (url.pathname === '/media') {
        await this.handleRead(req, res, url);
        return;
      }
      this.sendText(res, 404, 'Not found');
    } catch (error) {
      if (error instanceof DemoMediaError) {
        this.sendText(res, error.statusCode, error.message);
        return;
      }
      this.sendText(res, 500, 'Demo media error');
    }
  }

  private async handleUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    if (req.method !== 'PUT') {
      throw new DemoMediaError('Method not allowed', 405);
    }

    const key = url.searchParams.get('key') ?? '';
    const contentType = url.searchParams.get('contentType') ?? '';
    const expires = url.searchParams.get('expires') ?? '';
    const token = url.searchParams.get('token') ?? '';
    const expiresAt = Number(expires);
    if (!/^\d+$/.test(expires) || !Number.isFinite(expiresAt)) {
      throw new DemoMediaError('Upload URL is invalid', 403);
    }
    if (expiresAt < Math.floor(Date.now() / 1000)) {
      throw new DemoMediaError('Upload URL has expired', 403);
    }
    const expected = this.sign(`put\n${key}\n${contentType}\n${expires}`);
    if (!tokensEqual(token, expected)) {
      throw new DemoMediaError('Upload URL is invalid', 403);
    }

    const declared = (req.headers['content-type'] ?? '').split(';')[0].trim();
    if (declared !== contentType) {
      throw new DemoMediaError('Content-Type does not match the signed upload', 415);
    }

    const advertised = Number(req.headers['content-length'] ?? '');
    if (
      Number.isFinite(advertised) &&
      advertised > VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES
    ) {
      req.resume();
      throw new DemoMediaError('Video exceeds the 100MB limit', 413);
    }

    const destination = this.resolveObjectPath(key);
    const partial = `${destination}.partial`;
    await mkdir(path.dirname(destination), { recursive: true });
    const cap = new ByteCap(VIDEO_CONSTRAINTS.MAX_FILE_SIZE_BYTES);
    try {
      await pipeline(req, cap, createWriteStream(partial));
      if (cap.seen < 1) {
        throw new DemoMediaError('Upload body is empty', 400);
      }
      await rm(destination, { force: true });
      await rename(partial, destination);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }

    this.applyCors(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('ok');
  }

  private async handleRead(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new DemoMediaError('Method not allowed', 405);
    }
    const key = url.searchParams.get('key') ?? '';
    const token = url.searchParams.get('token') ?? '';
    const expected = this.sign(`get\n${key}`);
    if (!tokensEqual(token, expected)) {
      throw new DemoMediaError('Media URL is invalid', 403);
    }
    const filePath = this.resolveObjectPath(key);
    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      throw new DemoMediaError('Video not found', 404);
    }
    if (!fileStat.isFile()) {
      throw new DemoMediaError('Video not found', 404);
    }

    const contentType = contentTypeForKey(key);
    const size = fileStat.size;
    this.applyCors(res);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=0');

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
      if (!match) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      const hasStart = match[1].length > 0;
      const hasEnd = match[2].length > 0;
      let start = hasStart ? Number(match[1]) : 0;
      let end = hasEnd ? Number(match[2]) : size - 1;
      if (!hasStart && hasEnd) {
        const suffix = Number(match[2]);
        start = Math.max(0, size - suffix);
        end = size - 1;
      }
      end = Math.min(end, size - 1);
      if (start >= size || end < start) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const ranged = createReadStream(filePath, { start, end });
      ranged.on('error', () => {
        if (!res.headersSent) {
          this.sendText(res, 500, 'Demo media error');
          return;
        }
        res.destroy();
      });
      ranged.pipe(res);
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', String(size));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  }
}
