import { buildX402Catalog } from '../lib/x402/catalog';
import { X402_SUPPORTED_KINDS, X402_PAY_TO } from '../lib/x402/constants';
const c = buildX402Catalog();
const fail = (m: string) => { console.error('FAIL:', m); process.exitCode = 1; };
const ok = (m: string) => console.log('ok:', m);
if (c.x402Version !== 2) fail('x402Version');
if (c.kind !== 'both') fail('kind should be both');
if (c.name !== 'Polypad') fail('name');
if (!c.description) fail('description');
if (c.facilitator.baseUrl !== 'https://polypad.family/api/x402') fail('facilitator.baseUrl');
if (JSON.stringify(c.facilitator.endpoints) !== JSON.stringify({supported:'/supported',verify:'/verify',settle:'/settle'})) fail('facilitator.endpoints');
if (JSON.stringify(c.facilitator.kinds) !== JSON.stringify(X402_SUPPORTED_KINDS)) fail('facilitator.kinds must mirror /supported');
if (c.facilitator.assets.length !== 3) fail('facilitator.assets length');
if (!Array.isArray(c.resources) || c.resources.length !== 3) fail('resources length 3');
for (const r of c.resources) {
  if (!r.url.startsWith('https://polypad.family/api/x402/products/')) fail('resource url domain: ' + r.url);
  if (r.method !== 'GET') fail('resource method');
  if (typeof r.priceUsd !== 'number') fail('resource priceUsd');
  if (!Array.isArray(r.accepts) || r.accepts.length !== 3) fail('resource accepts');
}
if (c.seller.payTo !== X402_PAY_TO) fail('seller.payTo');
if (c.attestation?.type !== 'none') fail('attestation');
if (!c.docs || !c.contact || !c.updated) fail('docs/contact/updated');
if (!Array.isArray(c.endpoints) || c.endpoints.length !== 3) fail('legacy endpoints kept');
if (!c.discovery?.wellKnown?.includes('.well-known/x402')) fail('discovery.wellKnown');
ok('catalog manifest shape (draft fields + legacy fields kept)');
console.log('resources:', (c.resources ?? []).map(r => r.url.split('/').pop()?.split('?')[0]).join(', '));
console.log('kinds:', JSON.stringify(c.facilitator.kinds.map(k => k.network + ':' + k.extra.asset.slice(0,6))));
