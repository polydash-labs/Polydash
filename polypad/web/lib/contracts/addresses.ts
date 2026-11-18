export function getFactoryAddress(): `0x${string}` | undefined {
  const addr = process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
  if (!addr || addr === '' || addr === '0x0000000000000000000000000000000000000000') return undefined;
  return addr as `0x${string}`;
}

/** Earlier factory (creator fee capped at 2%). Its launches keep trading and are still listed. */
export const LEGACY_FACTORY_ADDRESS = '0x2C84cFCD8d283EF750E09Fbed735d67F67845dB2' as const;

/** Every factory whose launches the site lists: current first, then legacy. */
export function getFactoryAddresses(): `0x${string}`[] {
  const cur = getFactoryAddress();
  const all = [cur, LEGACY_FACTORY_ADDRESS].filter(Boolean) as `0x${string}`[];
  return all.filter((a, i) => all.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i);
}

export function getCommitVaultAddress(): `0x${string}` | undefined {
  const addr = process.env.NEXT_PUBLIC_COMMIT_VAULT_ADDRESS;
  if (!addr || addr === '' || addr === '0x0000000000000000000000000000000000000000') return undefined;
  return addr as `0x${string}`;
}

export function getExplorerUrl(): string {
  return process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://robinhoodchain.blockscout.com';
}

export function getExplorerTxUrl(hash: string): string {
  return `${getExplorerUrl()}/tx/${hash}`;
}

export function getExplorerAddressUrl(address: string): string {
  return `${getExplorerUrl()}/address/${address}`;
}

/** Agent Credit Score — AgentRegistry (deployed Nov 17, 2026). */
export function getAgentRegistryAddress(): `0x${string}` | undefined {
  const addr = process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS;
  if (!addr || addr === '' || addr === '0x0000000000000000000000000000000000000000') return undefined;
  return addr as `0x${string}`;
}

/** Agent Credit Score — AgentScore (deployed Nov 17, 2026). */
export function getAgentScoreAddress(): `0x${string}` | undefined {
  const addr = process.env.NEXT_PUBLIC_AGENT_SCORE_ADDRESS;
  if (!addr || addr === '' || addr === '0x0000000000000000000000000000000000000000') return undefined;
  return addr as `0x${string}`;
}

/** x402 — PolypadSpendVault (deployed Nov 17, 2026). */
export function getSpendVaultAddress(): `0x${string}` | undefined {
  const addr = process.env.NEXT_PUBLIC_SPEND_VAULT_ADDRESS;
  if (!addr || addr === '' || addr === '0x0000000000000000000000000000000000000000') return undefined;
  return addr as `0x${string}`;
}
