import { NextResponse } from 'next/server';
import { getSliceClaims } from '@/lib/slice-server';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const account = new URL(req.url).searchParams.get('account') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) return NextResponse.json({ error: 'invalid_account' }, { status: 400 });
  try { return NextResponse.json(await getSliceClaims(account as `0x${string}`)); }
  catch (e) { console.error('slice claims', e); return NextResponse.json({ error: 'rpc_error' }, { status: 502 }); }
}
