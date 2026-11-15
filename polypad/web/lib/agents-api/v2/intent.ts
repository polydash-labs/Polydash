/**
 * Natural-language intents. A deterministic parser, not a model: it turns common requests into a tool name
 * and arguments, and lists what is still missing. The chat agent can use it as an opening step, or skip it and
 * call the tools directly. It never guesses an amount or an asset it cannot read from the text.
 */
import { isAddress, getAddress } from 'viem';

export type IntentName =
  | 'help' | 'trending' | 'new_launches' | 'protections' | 'token_info' | 'buy' | 'sell' | 'portfolio' | 'list_funds' | 'fund_create'
  | 'fund_mint' | 'fund_redeem' | 'nfts' | 'nft_buy' | 'tx_status' | 'token_launch' | 'unknown';

export type Missing = { field: string; question: string };

export type ParsedIntent = {
  intent: IntentName;
  confidence: 'high' | 'medium' | 'low';
  tool: string | null;
  arguments: Record<string, unknown>;
  missing: Missing[];
  needsWallet: boolean;
  /** Things the user asked for that this API cannot do. */
  unsupported: string[];
  say: string;
};

/** Decimal ETH string to wei without floating point. Returns null for anything that is not a plain decimal. */
export function ethToWei(text: string): bigint | null {
  const m = /^(\d{0,12})(?:\.(\d{1,18}))?$/.exec(text.trim());
  if (!m || (m[1] === '' && m[2] === undefined)) return null;
  const whole = BigInt(m[1] || '0');
  const frac = BigInt(((m[2] ?? '') + '0'.repeat(18)).slice(0, 18));
  return whole * 10n ** 18n + frac;
}

const ADDR_RE = /0x[0-9a-fA-F]{40}/;
const HASH_RE = /0x[0-9a-fA-F]{64}/;
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const STOP = new Set(['my', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'with', 'me', 'some', 'all', 'half', 'eth', 'ether', 'token', 'tokens', 'coin', 'worth', 'to', 'it', 'that', 'this', 'fund', 'funds', 'nft', 'nfts']);

function tokenAfter(text: string): string | null {
  const addr = ADDR_RE.exec(text);
  if (addr) return getAddress(addr[0]);
  const m = /\$([A-Za-z0-9_]{1,24})/.exec(text);
  if (m) return m[1];
  return null;
}

function amountEth(text: string): { wei: bigint | null; usd: boolean } {
  if (/\$\s?\d/.test(text) && !/\$[A-Za-z]/.test(text.replace(/\$\s?\d[\d,.]*/g, ''))) return { wei: null, usd: true };
  const usd = /(\d[\d,.]*)\s*(usd|usdc|usdt|dollars?|bucks)\b/i.test(text);
  const m = /(\d*\.?\d+)\s*(?:eth|ether)\b/i.exec(text);
  if (m) return { wei: ethToWei(m[1]), usd: false };
  return { wei: null, usd };
}

function symbolFromWords(text: string, after: RegExp): string | null {
  const m = after.exec(text);
  if (!m) return null;
  const words = m[1].split(/[\s,]+/).filter(Boolean);
  for (const w of words) {
    const clean = w.replace(/[^A-Za-z0-9_$]/g, '').replace(/^\$/, '');
    if (clean && !STOP.has(clean.toLowerCase()) && !/^\d/.test(clean)) return clean;
  }
  return null;
}

export function parseIntent(raw: string): ParsedIntent {
  const text = raw.trim().replace(/\s+/g, ' ');
  const low = text.toLowerCase();
  const base = (p: Partial<ParsedIntent> & Pick<ParsedIntent, 'intent' | 'say'>): ParsedIntent => ({
    confidence: 'high', tool: null, arguments: {}, missing: [], needsWallet: false, unsupported: [], ...p,
  });

  if (!text) return base({ intent: 'help', tool: 'polypad_what_can_i_do', say: 'Tell me what you want to do, or ask what is possible.', confidence: 'low' });

  const hash = HASH_RE.exec(text);
  if (hash && /(tx|transaction|go through|confirm|status|pending|did)/.test(low)) {
    return base({ intent: 'tx_status', tool: 'polypad_get_tx_status', arguments: { hash: hash[0] }, say: 'Checking that transaction.' });
  }

  if (/\b(what can (i|you)|help|get started|start|how does this work|what is polypad|menu)\b/.test(low) && !/\b(buy|sell|launch|mint)\b/.test(low)) {
    return base({ intent: 'help', tool: 'polypad_what_can_i_do', say: 'Here is what you can do with Polypad.' });
  }

  // ---------- fund create
  if (/\b(launch|create|start|make|spin up|open)\b.*\b(fund)\b/.test(low) && !/\b(show|list|find|browse)\b/.test(low)) {
    const after = /\b(?:with|holding|that holds|containing|holds)\s+(.+)$/i.exec(text)?.[1] ?? '';
    const parts = after.split(/,| and |\+|&/i).map((s) => s.trim()).filter(Boolean);
    const assets: string[] = [];
    const unsupported: string[] = [];
    for (const p of parts) {
      if (/stock/i.test(p)) { unsupported.push(`${p} (stock tokens are not part of the shipped funds)`); continue; }
      const w = p.replace(/^(a|an|the|\d+|one|two|three|four|five)\s+/i, '').replace(/[^A-Za-z0-9_$]/g, ' ').trim().split(' ')[0].replace(/^\$/, '');
      if (w && !STOP.has(w.toLowerCase())) assets.push(w);
    }
    const args: Record<string, unknown> = {};
    if (assets.length) args.assets = assets;
    const nm = /(?:called|named)\s+"?([^",]+?)"?(?:\s+(?:ticker|symbol)\b|,|$)/i.exec(text);
    if (nm) args.name = nm[1].trim();
    const sy = /(?:ticker|symbol)\s+\$?([A-Za-z0-9]{1,16})/i.exec(text);
    if (sy) args.symbol = sy[1].toUpperCase();
    const missing: Missing[] = [];
    if (!args.name) missing.push({ field: 'name', question: 'What should the fund be called?' });
    if (!args.symbol) missing.push({ field: 'symbol', question: 'What short ticker should it use (up to 16 characters)?' });
    missing.push({ field: 'mintPriceEth', question: 'What price per share in ETH (for example 0.01)?' });
    missing.push({ field: 'raiseCapEth', question: 'What is the raise cap in ETH?' });
    return base({
      intent: 'fund_create', tool: 'polypad_prepare_fund_create', arguments: args, missing, needsWallet: true, unsupported,
      confidence: 'medium',
      say: unsupported.length
        ? 'A fund can only hold the assets its published template lists. I will show the templates that exist so you can choose.'
        : 'I will match your assets to a published template, then ask for the share price and cap.',
    });
  }

  // ---------- token launch
  if (/\b(launch|create|deploy|make)\b.*\b(token|coin)\b/.test(low) && !/\bfund\b/.test(low)) {
    const args: Record<string, unknown> = {};
    const nm = /(?:called|named)\s+"?([^",]+?)"?(?:\s+(?:ticker|symbol)\b|,|$)/i.exec(text);
    if (nm) args.name = nm[1].trim();
    const sy = /(?:ticker|symbol)\s+\$?([A-Za-z0-9]{1,16})/i.exec(text);
    if (sy) args.symbol = sy[1].toUpperCase();
    const missing: Missing[] = [];
    if (!args.name) missing.push({ field: 'name', question: 'What is the token name?' });
    if (!args.symbol) missing.push({ field: 'symbol', question: 'What is the ticker?' });
    missing.push({ field: 'creatorFeeBps', question: 'What creator fee, from 0% to 5%? (0 means 0%.)' });
    return base({ intent: 'token_launch', tool: 'polypad_prepare_token_launch', arguments: args, missing, needsWallet: true, confidence: 'medium', say: 'I can prepare a token launch. I need a few details.' });
  }

  // ---------- sell
  const sell = /\b(sell|dump|exit|cash out|offload)\b/.exec(low);
  if (sell && !/\bfund\b|shares\b/.test(low)) {
    const tok = tokenAfter(text) ?? symbolFromWords(text, /\b(?:sell|dump|exit|cash out|offload)\s+(?:(?:all|half|\d+%?|\d[\d,.]*)\s+)?(?:of\s+)?(?:my\s+)?(.+)$/i);
    const args: Record<string, unknown> = {};
    if (tok) args.token = tok;
    const pct = /(\d{1,3})\s*%/.exec(text);
    if (/\ball\b/.test(low)) args.percentOfBalance = 100;
    else if (/\bhalf\b/.test(low)) args.percentOfBalance = 50;
    else if (pct && Number(pct[1]) >= 1 && Number(pct[1]) <= 100) args.percentOfBalance = Number(pct[1]);
    const missing: Missing[] = [];
    if (!args.token) missing.push({ field: 'token', question: 'Which token do you want to sell?' });
    if (args.percentOfBalance === undefined) missing.push({ field: 'percentOfBalance', question: 'How much: all, half, or a percent of your balance?' });
    return base({ intent: 'sell', tool: 'polypad_prepare_sell', arguments: args, missing, needsWallet: true, say: 'I will quote the sale and show a summary before you sign.' });
  }

  // ---------- fund mint / redeem
  if (/\b(invest|put|mint|deposit)\b.*\bfund\b|\bfund\b.*\b(invest|mint)\b|\bmint\b.*\bshares?\b/.test(low)) {
    const args: Record<string, unknown> = {};
    const addr = ADDR_RE.exec(text);
    if (addr) args.fund = getAddress(addr[0]);
    const q = /(\d+|one|two|three|four|five)\s+shares?/i.exec(text);
    if (q) args.quantity = WORD_NUM[q[1].toLowerCase()] ?? Number(q[1]);
    const missing: Missing[] = [];
    if (!args.fund) missing.push({ field: 'fund', question: 'Which fund (name or address)? I can list open funds.' });
    if (!args.quantity) missing.push({ field: 'quantity', question: 'How many shares?' });
    return base({ intent: 'fund_mint', tool: 'polypad_prepare_fund_mint', arguments: args, missing, needsWallet: true, confidence: 'medium', say: 'I will check the fund is open and show the cost before you sign.' });
  }
  if (/\b(redeem|withdraw|exit|refund|cash out)\b.*\b(fund|shares?)\b/.test(low) || /\bfund\b.*\b(exit|redeem|refund)\b/.test(low)) {
    const args: Record<string, unknown> = {};
    const addr = ADDR_RE.exec(text);
    if (addr) args.fund = getAddress(addr[0]);
    const missing: Missing[] = args.fund ? [] : [{ field: 'fund', question: 'Which fund? I can show the funds you hold.' }];
    return base({ intent: 'fund_redeem', tool: 'polypad_prepare_fund_redeem', arguments: args, missing, needsWallet: true, say: 'I will check whether exit or refund is open for that fund.' });
  }

  // ---------- NFTs
  const listing = /listing\s*#?(\d+)/i.exec(text);
  if (listing && /\b(buy|purchase|get|grab)\b/.test(low)) {
    return base({ intent: 'nft_buy', tool: 'polypad_prepare_nft_buy', arguments: { listingId: Number(listing[1]) }, needsWallet: true, say: 'I will check the listing is still valid and show the price before you sign.' });
  }
  if (/\bnfts?\b|\bcollection\b|\bmint\b/.test(low)) {
    if (/\b(buy|mint|purchase|get|grab)\b/.test(low)) {
      const args: Record<string, unknown> = {};
      const addr = ADDR_RE.exec(text);
      if (addr) args.collection = getAddress(addr[0]);
      const q = /(\d+|one|two|three|four|five)\s*(?:x\s*)?(?:nfts?)?/i.exec(text.replace(/0x[0-9a-fA-F]+/g, ''));
      if (q) args.quantity = WORD_NUM[q[1].toLowerCase()] ?? Number(q[1]);
      const lid = /listing\s*#?(\d+)/i.exec(text);
      if (lid) args.listingId = Number(lid[1]);
      const name = symbolFromWords(text, /\b(?:mint|buy|get|grab|purchase)\s+(?:\d+\s+|one\s+|two\s+|three\s+)?(?:x\s+)?(?:nfts?\s+)?(?:from\s+|of\s+)?(.+)$/i);
      if (name && !args.collection && !args.listingId) args.collectionName = name;
      const missing: Missing[] = [];
      if (!args.collection && !args.listingId && !args.collectionName) missing.push({ field: 'collection', question: 'Which collection (name or address), or which marketplace listing?' });
      return base({ intent: 'nft_buy', tool: 'polypad_prepare_nft_buy', arguments: args, missing, needsWallet: true, confidence: 'medium', say: 'I will check supply, wallet limits, and price before you sign.' });
    }
    const under = /under\s+(\d*\.?\d+)\s*eth/i.exec(text);
    return base({ intent: 'nfts', tool: under ? 'polypad_list_nft_listings' : 'polypad_list_nfts', arguments: under ? { maxPriceEth: under[1] } : {}, say: 'Here are the Polypad NFT collections.' });
  }

  // ---------- buy
  if (/\b(buy|ape|purchase|grab|pick up|get|swap)\b/.test(low) || /\binto\b/.test(low)) {
    const { wei, usd } = amountEth(text);
    const tok = tokenAfter(text) ?? symbolFromWords(text, /\b(?:of|into|buy|ape|purchase|grab|get)\s+(?:(?:me|some)\s+)?(?:\d*\.?\d+\s*(?:eth|ether)\s+(?:of|worth of|in|into)\s+)?(.+)$/i);
    const args: Record<string, unknown> = {};
    if (tok) args.token = tok;
    if (wei !== null) args.amountWei = wei.toString();
    const missing: Missing[] = [];
    if (!args.token) missing.push({ field: 'token', question: 'Which token do you want to buy?' });
    if (wei === null) missing.push({ field: 'amountEth', question: usd ? 'I size trades in ETH, not dollars. How much ETH?' : 'How much ETH do you want to spend?' });
    return base({ intent: 'buy', tool: 'polypad_prepare_buy', arguments: args, missing, needsWallet: true, say: 'I will quote the trade and show a summary before you sign.' });
  }

  // ---------- reads
  if (/\b(portfolio|holdings?|what do i (hold|own|have)|my (tokens|bags|positions|balance)|balance of)\b/.test(low)) {
    const addr = ADDR_RE.exec(text);
    return base({ intent: 'portfolio', tool: 'polypad_portfolio', arguments: addr ? { address: getAddress(addr[0]) } : {}, missing: addr ? [] : [{ field: 'address', question: 'Which wallet address should I look at?' }], say: 'Reading that wallet. This is read-only.' });
  }
  if (/\b(risk|risky|rug|protections?|check|legit|trust|holder protections)\b/.test(low) && (tokenAfter(text) || /\b(is|are|about)\b/.test(low))) {
    const tok = tokenAfter(text) ?? symbolFromWords(text, /\b(?:is|about|for|on|check)\s+(?:the\s+)?(.+?)(?:\s+(?:risky|ok|legit|a rug|protected))?\??$/i);
    return base({ intent: 'protections', tool: 'polypad_token_protections', arguments: tok ? { token: tok } : {}, missing: tok ? [] : [{ field: 'token', question: 'Which token should I check?' }], say: 'Reading its on-chain protections.' });
  }
  if (/\b(trending|hot|popular|top tokens|what'?s moving|active)\b/.test(low)) {
    return base({ intent: 'trending', tool: 'polypad_list_tokens', arguments: { sort: 'trending', limit: 8 }, say: 'Here is what is most active.' });
  }
  if (/\b(new|latest|recent|fresh)\b.*\b(launch|launches|tokens?|coins?)\b|\bjust launched\b/.test(low)) {
    return base({ intent: 'new_launches', tool: 'polypad_list_tokens', arguments: { sort: 'new', limit: 8 }, say: 'Here are the newest launches.' });
  }
  if (/\bfunds?\b/.test(low)) {
    const args: Record<string, unknown> = {};
    if (/\b(open|raising|accepting)\b/.test(low)) args.open = true;
    return base({ intent: 'list_funds', tool: 'polypad_list_funds', arguments: args, say: 'Here are the Polypad funds.' });
  }
  const tok = tokenAfter(text);
  if (tok && /\b(price|info|about|tell me|show|look up|lookup|details)\b/.test(low)) {
    return base({ intent: 'token_info', tool: 'polypad_get_token', arguments: { token: tok }, say: 'Looking that token up.' });
  }
  return base({ intent: 'unknown', tool: 'polypad_what_can_i_do', confidence: 'low', say: 'I did not catch that. Here is what I can do.' });
}

export { isAddress };
