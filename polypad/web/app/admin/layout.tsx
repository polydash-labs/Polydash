import type { Metadata } from 'next';

/** Admin pages are tools, not content — keep them out of search results. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
