import type { Metadata } from 'next';

/** Canonical site URL. This was polypad.abacusai.app (the fallback host) — every
 * page using pageMetadata resolved its canonical + OG URLs against the wrong
 * domain. polypad.family is the canonical home; keep it here. */
export const SITE_URL = 'https://polypad.family';
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

/** Title, description, canonical URL and matching OpenGraph/Twitter tags for a page.
 * URLs are absolute against SITE_URL so they are right even if metadataBase
 * changes. Pass noindex for functional/private pages (they still get a
 * canonical so crawlers that do fetch them see a consistent URL). */
export function pageMetadata({ title, description, path, image = DEFAULT_OG_IMAGE, imageAlt, noindex = false }: { title: string; description: string; path: string; image?: string; imageAlt?: string; noindex?: boolean }): Metadata {
  const url = `${SITE_URL}${path}`;
  const imgUrl = image.startsWith('http') ? image : `${SITE_URL}${image}`;
  const images = [{ url: imgUrl, width: 1200, height: 630, alt: imageAlt ?? title }];
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: 'Polypad', url, title, description, images },
    twitter: { card: 'summary_large_image', title, description, images: [imgUrl] },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

/** JSON-LD for the homepage: the org and the site itself. No SearchAction —
 * the site has no public search box to point it at. */
export const ORGANIZATION_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Polypad',
  url: SITE_URL,
  logo: `${SITE_URL}/polydash-logo-cmc-200.png`,
  description: SHARE_DESCRIPTION,
  sameAs: ['https://x.com/Polydash_', 'https://github.com/polydash-labs/Polydash', 'https://www.instagram.com/polydash_/'],
};

export const WEBSITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Polypad',
  url: SITE_URL,
  inLanguage: 'en',
};
