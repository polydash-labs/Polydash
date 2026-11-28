import { TEMPLATE2_MANDATE_TEXT } from './template2';
import { TEMPLATE3_MANDATE_TEXT } from './template3';
import { TEMPLATE4_MANDATE_TEXT } from './template4';
import { TEMPLATE5_MANDATE_TEXT } from './template5';
import { TEMPLATE10_MANDATE_TEXT } from './template10';
import { TEMPLATE11_MANDATE_TEXT } from './template11';

/** Site copies keyed by CID. Shown only when no IPFS gateway serves the file; IPFS stays the source of truth. */
const BUNDLED_BY_CID: Record<string, string> = {
  bafybeidy4qmoeg2mo4xz2czni7pxgmycv4ttsxt2spgif7pxzp2tv4zmki: TEMPLATE2_MANDATE_TEXT,
  bafybeiec5tvugkpmzhrnzsx4dgbbsnfxh4t4cqqnetca6xeoetm6liquhm: TEMPLATE3_MANDATE_TEXT,
  bafybeicug6lgvloamdsg5eju3hk23efvah5yuiqteuyrxstjx2fma2g4hy: TEMPLATE4_MANDATE_TEXT,
  bafybeibvdjvhttfrgsxpuwosgqbvsimvuppzsg562kbv26lfzk5vqan5r4: TEMPLATE5_MANDATE_TEXT,
  bafybeigtntgj2obsl2u6tmm2zm7vhvyukz6tlh34mxn6pup7bwn6da4dpi: TEMPLATE10_MANDATE_TEXT,
  bafybeiflq7wbtpdvvyqbzsgtfbolzv5mxtbfyalstpt35qgyqms7awwvl4: TEMPLATE11_MANDATE_TEXT,
};

/** CIDs whose site copy is derived rather than the exact published file. Empty: every bundled copy is the exact file. */
const DERIVED_CIDS = new Set<string>();

const cidOf = (uri: string) => /^ipfs:\/\/([A-Za-z0-9]+)\/?$/.exec(uri.trim())?.[1] ?? null;

/** Bundled copy for `ipfs://CID` (root path only), or null. */
export function bundledMandate(uri: string): string | null {
  const cid = cidOf(uri);
  return cid ? BUNDLED_BY_CID[cid] ?? null : null;
}

export function isDerivedMandate(uri: string): boolean {
  const cid = cidOf(uri);
  return !!cid && DERIVED_CIDS.has(cid);
}

export const DERIVED_MANDATE_NOTE = 'Site copy: Strategy #2\'s write-up with only the performance fee changed, because the published file is not reachable on IPFS yet.';
