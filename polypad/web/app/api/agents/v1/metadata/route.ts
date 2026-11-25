import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createS3Client, getBucketConfig } from '@/lib/aws-config';
import { getPublicFileUrl } from '@/lib/s3';
import { allowAttempt, fail, json, requireKey } from '@/lib/agents-api/core';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 1024 * 1024;
const s3 = createS3Client();

function sniff(b: Uint8Array): { ext: string; type: string } | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', type: 'image/png' };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

/** Hosts a token image (png/jpg/webp, max 1 MB) in the same storage as site logo uploads. Multipart field "file". */
export async function POST(req: Request) {
  const key = await requireKey(req);
  if (key instanceof Response) return key;
  if (!allowAttempt(`meta:${key.id}`, 20, 60 * 60 * 1000)) {
    return fail(429, 'rate_limited', 'Limit reached: 20 image uploads per API key per hour.', { scope: 'api_key', limit: 20, window: '1h', retryAfter: 3600 }, { 'retry-after': '3600' });
  }
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES + 64 * 1024) return fail(413, 'too_large', 'Image must be 1 MB or smaller.');
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') return fail(400, 'file_required', 'Send multipart/form-data with the image in a field named "file".');
    if (file.size > MAX_BYTES) return fail(413, 'too_large', 'Image must be 1 MB or smaller.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniff(bytes);
    if (!kind) return fail(415, 'unsupported_type', 'Use a PNG, JPG or WEBP image.');
    const { bucketName, folderPrefix } = getBucketConfig();
    const path = `${folderPrefix}public/uploads/${Date.now()}-token-logos/${crypto.randomUUID()}.${kind.ext}`;
    await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: path, Body: bytes, ContentType: kind.type }));
    const imageUri = await getPublicFileUrl(path);
    return json({ imageUri, contentType: kind.type, bytes: bytes.length }, 201);
  } catch (e) {
    console.error('agents v1 metadata failed', e);
    return fail(500, 'server_error', 'Could not store the image.');
  }
}
