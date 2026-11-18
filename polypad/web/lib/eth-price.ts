// Shared ETH/USD spot price (Coinbase), 60 s in-memory cache. Used by /api/eth-price and server routes.
let cache: { price: number; at: number } | null = null;

/** Returns the ETH/USD price, the last good cached value on failure, or 0 if none. */
export async function getEthUsd(): Promise<number> {
  try {
    if (cache && Date.now() - cache.at < 60_000) return cache.price;
    const res = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', { cache: 'no-store' });
    const json = await res.json();
    const price = Number(json?.data?.amount);
    if (!Number.isFinite(price) || price <= 0) throw new Error('bad price');
    cache = { price, at: Date.now() };
    return price;
  } catch (e) {
    console.error('eth-price error', e);
    return cache?.price ?? 0;
  }
}
