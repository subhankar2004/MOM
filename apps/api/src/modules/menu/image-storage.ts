import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../../config/env.js';

/** Photos are compressed in the browser first (WebP, ≤ 1200 px), so 2 MB is generous. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' } as const;
export type ImageType = keyof typeof IMAGE_TYPES;
const UPLOAD_TTL_SECONDS = 300;

export interface PresignedUpload {
  key: string;
  /** PUT the file here with exactly `headers`. */
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

/** Where menu photos live: S3 on AWS, SeaweedFS locally, an in-memory fake in tests. */
export interface ImageStorage {
  presignPut(input: { key: string; contentType: ImageType; size: number }): Promise<PresignedUpload>;
  /** Size and type of an uploaded object, or null if there's nothing at `key`. */
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;
  delete(key: string): Promise<void>;
}

/**
 * Every key a stall can write starts with its own prefix, and the server picks the key, so
 * a vendor can't upload over another stall's photos (or reuse one of theirs on an item).
 */
export function itemImageKey(stallId: string, contentType: ImageType): string {
  return `stalls/${stallId}/items/${randomUUID()}.${IMAGE_TYPES[contentType]}`;
}

const KEY_PATTERN =
  /^stalls\/([0-9a-f-]{36})\/items\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$/;

export function isStallImageKey(stallId: string, key: string): boolean {
  const m = KEY_PATTERN.exec(key);
  return m !== null && m[1] === stallId;
}

export function createImageStorage(env: Env): ImageStorage {
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    // Otherwise the SDK signs a checksum of the (empty) presign body into the URL and every
    // browser upload fails with BadDigest.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    // On AWS no keys are set: the SDK uses the ECS task's IAM role.
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
  const bucket = env.S3_BUCKET;

  return {
    async presignPut({ key, contentType, size }) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
        CacheControl: 'public, max-age=31536000, immutable',
      });
      // Type, length and cache headers are signed (not query params), so the upload must be
      // exactly the size and type that was approved.
      const signed = new Set(['content-type', 'content-length', 'cache-control']);
      const url = await getSignedUrl(client, command, {
        expiresIn: UPLOAD_TTL_SECONDS,
        signableHeaders: signed,
        unhoistableHeaders: signed,
      });
      return {
        key,
        url,
        headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
        expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000),
      };
    },
    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
      } catch (err) {
        if (err instanceof NotFound) return null;
        if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
        throw err;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/** In-memory storage for tests: `put` simulates the browser's upload. */
export class FakeImageStorage implements ImageStorage {
  readonly objects = new Map<string, { size: number; contentType: string }>();
  readonly deleted: string[] = [];

  async presignPut({ key, contentType }: { key: string; contentType: ImageType; size: number }) {
    return {
      key,
      url: `https://uploads.test/${key}?signature=fake`,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000),
    };
  }

  put(key: string, size: number, contentType = 'image/webp') {
    this.objects.set(key, { size, contentType });
  }

  async head(key: string) {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string) {
    this.objects.delete(key);
    this.deleted.push(key);
  }
}
