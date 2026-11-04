import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { createS3Client, getBucketConfig } from './aws-config';
import {
  LOGO_POST_EXPIRES_SECONDS,
  logoObjectKey,
  logoPostConditions,
  type LogoPresignInput,
  type LogoPresignResult,
} from './logo-upload';

const s3 = createS3Client();

export async function generatePresignedLogoPost(input: LogoPresignInput): Promise<LogoPresignResult> {
  const { bucketName, folderPrefix } = getBucketConfig();
  const cloud_storage_path = logoObjectKey(folderPrefix, input.id, input.ext);
  const { url, fields } = await createPresignedPost(s3, {
    Bucket: bucketName,
    Key: cloud_storage_path,
    Conditions: logoPostConditions(input.contentType),
    Fields: {
      'Content-Type': input.contentType,
    },
    Expires: LOGO_POST_EXPIRES_SECONDS,
  });
  return { uploadUrl: url, fields, cloud_storage_path };
}

export async function getPublicFileUrl(cloud_storage_path: string) {
  const { bucketName } = getBucketConfig();
  const region = (await s3.config.region()) || process.env.AWS_REGION || 'us-east-1';
  const key = cloud_storage_path.split('/').map(encodeURIComponent).join('/');
  return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
}
