import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // API routes and the admin tooling have no search value. Everything
        // else that should not be indexed carries a robots noindex meta tag
        // instead — it must stay crawlable so Google can see that tag.
        disallow: ['/api/', '/admin/', '/agents/earn/review'],
      },
    ],
    sitemap: 'https://polypad.family/sitemap.xml',
  };
}
