// Message formats the owner signs with their wallet. Pure string
// builders — no server imports — so the browser can build the exact same
// message the server verifies. Keep the formats in sync with
// lib/cdp-base/wallets.ts (creation) and the freeze route.
export function usdCentsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function creationMessage(input: {
  ownerAddress: string;
  name: string;
  dailyCapUsdCents: number;
  perPaymentCapUsdCents: number;
  expiresAtIso: string;
  validUntil: number;
  nonce: string;
}): string {
  return [
    'Create a Base agent wallet on Polypad',
    `Owner: ${input.ownerAddress}`,
    `Name: ${input.name}`,
    `Daily cap: ${usdCentsToUsd(input.dailyCapUsdCents)}`,
    `Per-payment cap: ${usdCentsToUsd(input.perPaymentCapUsdCents)}`,
    `Expires: ${input.expiresAtIso}`,
    `Valid until: ${input.validUntil}`,
    `Nonce: ${input.nonce}`,
  ].join('\n');
}

export function freezeMessage(address: string, frozen: boolean, validUntil: number): string {
  return [`${frozen ? 'Freeze' : 'Unfreeze'} Base agent wallet ${address}`, `Valid until: ${validUntil}`].join('\n');
}
