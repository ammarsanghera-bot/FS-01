import { randomBytes } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { env } from "../config.js";
import { AppError } from "./errors.js";

export type StoredFile = { key: string; url: string };

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function assertImageUpload(file: { mimetype: string; size: number; buffer: Buffer }): void {
  if (!ALLOWED.has(file.mimetype)) {
    throw new AppError("Upload a JPEG, PNG, WEBP, or GIF image", 415);
  }
  if (file.size > 5 * 1024 * 1024) throw new AppError("Images must be 5 MB or smaller", 413);
  if (!hasImageMagic(file.buffer, file.mimetype)) {
    throw new AppError("The file contents do not match an allowed image type", 415);
  }
}

function hasImageMagic(buffer: Buffer, mime: string): boolean {
  if (buffer.length < 12) return false;
  if (mime === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/gif") return buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a";
  if (mime === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export async function saveImage(file: { mimetype: string; buffer: Buffer; originalname: string }): Promise<StoredFile> {
  assertImageUpload({ mimetype: file.mimetype, size: file.buffer.length, buffer: file.buffer });
  const ext = file.mimetype === "image/png" ? "png" : file.mimetype === "image/webp" ? "webp" : file.mimetype === "image/gif" ? "gif" : "jpg";
  const key = `${new Date().toISOString().slice(0, 10)}/${randomBytes(16).toString("hex")}.${ext}`;
  if (env.storageDriver === "s3" && env.s3.bucket) return saveS3(key, file.mimetype, file.buffer);
  return saveLocal(key, file.buffer);
}

async function saveLocal(key: string, buffer: Buffer): Promise<StoredFile> {
  const target = path.join(env.uploadDir, key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buffer);
  return { key, url: `${env.publicApiUrl}/uploads/${key}` };
}

async function saveS3(key: string, contentType: string, buffer: Buffer): Promise<StoredFile> {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: env.s3.region,
    endpoint: env.s3.endpoint || undefined,
    forcePathStyle: Boolean(env.s3.endpoint),
    credentials: { accessKeyId: env.s3.accessKey, secretAccessKey: env.s3.secretKey },
  });
  await client.send(new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: buffer, ContentType: contentType }));
  const url = env.s3.publicUrl ? `${env.s3.publicUrl}/${key}` : `${env.s3.endpoint}/${env.s3.bucket}/${key}`;
  return { key, url };
}

export async function deleteStored(key: string): Promise<void> {
  if (env.storageDriver === "s3" && env.s3.bucket) {
    const { S3Client, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: env.s3.region,
      endpoint: env.s3.endpoint || undefined,
      forcePathStyle: Boolean(env.s3.endpoint),
      credentials: { accessKeyId: env.s3.accessKey, secretAccessKey: env.s3.secretKey },
    });
    await client.send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }));
    return;
  }
  await unlink(path.join(env.uploadDir, key)).catch(() => undefined);
}
