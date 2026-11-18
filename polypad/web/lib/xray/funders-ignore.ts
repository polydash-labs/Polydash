// Funders that many unrelated people share (bridges, exchange hot wallets, faucets). Wallets funded by these
// are never grouped as a "common funder" bundle. Lowercase. Add addresses as they are confirmed.
export const FUNDERS_IGNORE: string[] = [
  // Robinhood Chain system / bridge senders
  '0x00000000000000000000000000000000000a4b05',
  '0x0000000000000000000000000000000000000064',
  '0x000000000000000000000000000000000000006e',
];

/** Explorer name/tag fragments that mark an address as a shared funder (exchange or bridge). */
export const FUNDER_LABEL_PATTERN = /(exchange|bridge|hot ?wallet|faucet|relay|cex|deposit)/i;
