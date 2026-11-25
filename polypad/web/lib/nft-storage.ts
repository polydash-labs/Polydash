import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createS3Client, getBucketConfig } from './aws-config';

// Collection files live at public/uploads/nft/<draftId>/{cover.<ext>, images/<n>.<ext>, metadata/<n>.json}.
// Paths are deterministic so metadata/ can serve as the on-chain baseURI. Files are write-once.
const s3 = createS3Client();

export const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ITEMS = 10_000;

export function isDraftId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
}

export function draftKey(draftId: string, rel: string) {
  return `${getBucketConfig().folderPrefix}public/uploads/nft/${draftId}/${rel}`;
}

export async function publicUrl(key: string) {
  const { bucketName } = getBucketConfig();
  const region = (await s3.config.region()) || process.env.AWS_REGION || 'us-east-1';
  return `https://${bucketName}.s3.${region}.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function exists(key: string) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: getBucketConfig().bucketName, Key: key }));
    return true;
  } catch (e: any) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return false;
    throw e;
  }
}

export async function presignPut(key: string, contentType: string) {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: getBucketConfig().bucketName, Key: key, ContentType: contentType }), { expiresIn: 3600 });
}

export async function putJson(key: string, body: unknown) {
  await s3.send(new PutObjectCommand({
    Bucket: getBucketConfig().bucketName,
    Key: key,
    Body: JSON.stringify(body),
    ContentType: 'application/json',
    CacheControl: 'public, max-age=300',
  }));
}
