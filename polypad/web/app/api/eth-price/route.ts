import { NextResponse } from 'next/server';
import { getEthUsd } from '@/lib/eth-price';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ price: await getEthUsd() });
}
