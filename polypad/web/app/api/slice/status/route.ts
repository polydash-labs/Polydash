import { NextResponse } from 'next/server';
import { getSliceStatus } from '@/lib/slice-server';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return NextResponse.json(await getSliceStatus()); }
  catch (e) { console.error('slice status', e); return NextResponse.json({ error: 'rpc_error' }, { status: 502 }); }
}
