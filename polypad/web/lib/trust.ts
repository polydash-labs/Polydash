import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';

export const TRUST_BASE = 'https://polypad.family';
export const EXPLORER_ADDRESS = 'https://robinhoodchain.blockscout.com/address/';
export const CONTACT_EMAIL = 'jon@dasheco.xyz';
export const POLYDASH_TOKEN = '0x319525528f42167eF7fC18b77b889958080568e4';

export function trustMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  const base = pageMetadata({ title, description, path });
  const url = `${TRUST_BASE}${path}`;
  return { ...base, alternates: { canonical: url }, openGraph: { ...base.openGraph, url } };
}
