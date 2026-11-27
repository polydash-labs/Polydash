// NFT collections hidden from the Polypad UI.
//
// These are test collections, hidden from every UI surface at Jon's request
// (Nov 25, 2026). Nothing is deleted: the collections stay on-chain exactly
// as deployed, and the MCP/API tooling still sees them — only the website
// stops listing them. To show one again, remove its address from this list.
//
// Both are "Everett Wier Rookie Card" (EWCARD) test collections from the
// fixed-price factory 0x297c232F2EBCbB4e3Cd0b97167a971fF795EDdDd.

const HIDDEN_NFT_COLLECTION_ADDRESSES = [
  // Everett Wier Rookie Card — test collection, factory index 5.
  "0x9780798799a5bc3b4e260959e5ef7ec3687d7884",
  // Everett Wier Rookie Card — test collection, factory index 6.
  "0x7feab5cda6af5838ba407b50e1e9e2b5e6069215",
] as const;

const HIDDEN_SET = new Set(
  HIDDEN_NFT_COLLECTION_ADDRESSES.map((a) => a.toLowerCase()),
);

/** The addresses hidden from the UI (lowercase). */
export const HIDDEN_NFT_COLLECTIONS: readonly string[] = [
  ...HIDDEN_NFT_COLLECTION_ADDRESSES,
];

/** True when this collection address is hidden from the UI. Case-insensitive. */
export function isHiddenNftCollection(address?: string | null): boolean {
  if (!address) return false;
  return HIDDEN_SET.has(address.toLowerCase());
}

/** Drop hidden collections from an address list. Returns a new array. */
export function filterHiddenNftCollections<T extends string>(
  addresses: readonly T[],
): T[] {
  return addresses.filter((a) => !isHiddenNftCollection(a));
}
