// Server only: reads transaction inputs (immutable) and derives the ERC-8021 label. Small in-memory cache.
import { agentClient } from '@/lib/agents-api/core';
import { attributionFromInput, type Attribution } from '@/lib/erc8021';

const cache = new Map<string, Attribution | null>();

export async function attributionForHash(hash: string): Promise<Attribution | null> {
  const key = hash.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const tx = await agentClient.getTransaction({ hash: key as `0x${string}` });
    const a = attributionFromInput(tx.input);
    if (cache.size > 20_000) cache.clear();
    cache.set(key, a);
    return a;
  } catch {
    return null; // not found / RPC error: no label, not cached
  }
}

export async function attributionForHashes(hashes: string[]) {
  const out: Record<string, Attribution | null> = {};
  const list = [...new Set(hashes.map((h) => h.toLowerCase()))];
  for (let i = 0; i < list.length; i += 10) {
    const part = list.slice(i, i + 10);
    const res = await Promise.all(part.map(attributionForHash));
    part.forEach((h, j) => { out[h] = res[j]; });
  }
  return out;
}
