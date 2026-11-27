import { NextResponse } from 'next/server';
import { buildCatalogPdf } from '@/lib/partnerships/catalog';

export const dynamic = 'force-dynamic';

/** GET /api/partnerships/catalog — the partner catalog as a PDF. */
export async function GET() {
  try {
    const bytes = await buildCatalogPdf();
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="polypad-partner-catalog.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    console.error('partner catalog failed', (e as Error)?.message);
    return NextResponse.json({ error: 'Could not build the catalog. Please try again shortly.' }, { status: 500 });
  }
}
