import type { Metadata } from 'next';

export const SITE_URL = 'https://polypad.abacusai.app';
export const DEFAULT_OG_IMAGE = '/og-image.png';

const SHARE_TITLE = 'Polypad: The Premiere Agentic Marketplace';
const SHARE_DESCRIPTION = 'The premiere agentic marketplace. Create your agent, give it a secure wallet, then launch, invest, stake, and pay per call — all on Robinhood Chain.';
const SHARE_IMAGE = 'https://polypad.family/og-image.png';

/** Site-wide share tags (root layout + home page). Exact values set by the owner. */
export const SITE_SHARE: Pick<Metadata, 'openGraph' | 'twitter' | 'alternates'> = {
  alternates: { canonical: 'https://polypad.family' },
  openGraph: {
    type: 'website',
    siteName: 'Polypad',
    url: 'https://polypad.family',
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    images: [{ url: SHARE_IMAGE, width: 1200, height: 630, alt: 'Polypad: The Premiere Agentic Marketplace' }],
  },
  twitter: { card: 'summary_large_image', title: SHARE_TITLE, description: SHARE_DESCRIPTION, images: [SHARE_IMAGE] },
};

/** Title, description, canonical URL and matching OpenGraph/Twitter tags for a page. */
export function pageMetadata({ title, description, path, image = DEFAULT_OG_IMAGE, imageAlt }: { title: string; description: string; path: string; image?: string; imageAlt?: string }): Metadata {
  const images = [{ url: image, width: 1200, height: 630, alt: imageAlt ?? title }];
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: 'Polypad', url: path, title, description, images },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
