import { NextResponse } from 'next/server';
import { handleLogoUpload } from '@/lib/logo-upload';

export const dynamic = 'force-dynamic';

// Per-IP limit is an in-memory sliding window (10 requests / 10 minutes) inside
// handleLogoUpload. A shared store is needed for this limit to apply across instances.
export async function POST(req: Request) {
  const result = await handleLogoUpload(req);
  return NextResponse.json(result.body, { status: result.status });
}
