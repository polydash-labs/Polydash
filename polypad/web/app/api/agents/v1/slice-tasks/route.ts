import { NextResponse } from 'next/server';
import { getSliceTasks } from '@/lib/slice-server';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return NextResponse.json(await getSliceTasks()); }
  catch (e) { console.error('slice tasks', e); return NextResponse.json({ error: 'rpc_error' }, { status: 502 }); }
}
