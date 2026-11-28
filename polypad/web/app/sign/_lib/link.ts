/**
 * Parses a /sign link. The link carries intent only (an action and its parameters), never calldata.
 * Every value is validated again by the API; this only rejects links that are clearly malformed.
 */
export const SIGN_ACTIONS = ['buy', 'sell', 'swap', 'nft-buy', 'nft-mint', 'nft-create', 'fund-create', 'fund-mint', 'fund-redeem', 'token-launch'] as const;
export type SignAction = (typeof SIGN_ACTIONS)[number];

const COMMON = ['v', 'a', 'f', 'ref', 'c', 'h', 'r'];
const PARAMS: Record<SignAction, string[]> = {
  buy: ['t', 'amt', 'sl'],
  sell: ['t', 'amt', 'pct', 'sl'],
  swap: ['ti', 'to', 'amt', 'sl', 'ag'],
  'nft-buy': ['l'],
  'nft-mint': ['col', 'q'],
  'nft-create': ['n', 's', 'img', 'd', 'bu', 'ms', 'mp', 'rb', 'mw', 'cw', 'fb'],
  'fund-create': ['fx', 'tpl', 'n', 's', 'mp', 'rc', 'ef', 'sk', 'rd', 'img', 'bu'],
  'fund-mint': ['fund', 'q'],
  'fund-redeem': ['fund', 'ids'],
  'token-launch': ['p'],
};

export type ParsedLink =
  | {
      ok: true;
      action: SignAction;
      /** Path segment for POST /api/agents/v2/prepare/<path>. */
      path: string;
      /** Body without from / ref / confirmLarge. */
      body: Record<string, unknown>;
      ref: string;
      client: string | null;
      chatCode: string | null;
      preparedFor: string | null;
      /** Optional https:// link back to the agent's flow, shown after the transaction confirms. */
      returnUrl: string | null;
      /** Addresses named in the link itself. */
      linkAddresses: string[];
    }
  | { ok: false; error: string; keyMaterial?: boolean };

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^\d{1,40}$/;
const REF = /^[a-z0-9_-]{1,24}$/;
const CLIENT = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * A return link is only ever an https:// URL, at most 2048 characters. Same rule as the API's
 * validReturnUrl — anything else is rejected with the link, so a bad return address can never
 * smuggle the user somewhere unexpected. Shared with the /sign?connect=1 flow.
 */
export function validReturnUrlParam(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v.length === 0 || v.length > 2048 || /\s/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !!u.hostname ? v : null;
  } catch {
    return null;
  }
}
const KEY_NAME = /priv|secret|seed|mnemonic|phrase|keystore|pk$|^key$|_key|key_/i;
const KEY_VALUE = /^(0x)?[0-9a-fA-F]{64}$/;

function intIn(v: string, min: number, max: number): number | null {
  if (!/^\d{1,9}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

function fromBase64Url(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function parseSignLink(sp: URLSearchParams): ParsedLink {
  const keys = Array.from(sp.keys());
  if (keys.length === 0) return { ok: false, error: 'This page needs a signing link from a chat agent. Nothing to show.' };

  // A field named like a key or seed phrase, or a value shaped like a private key: ignore the whole link.
  for (const [k, v] of sp) {
    if (KEY_NAME.test(k) || KEY_VALUE.test(v.trim())) {
      return { ok: false, keyMaterial: true, error: 'This link contains a field that looks like a private key or seed phrase. It was ignored. Polypad never needs a private key or seed phrase, and nothing was sent.' };
    }
  }
  if (new Set(keys).size !== keys.length) return { ok: false, error: 'This link repeats a parameter. Ask the chat for a new link.' };
  if (sp.get('v') !== '1') return { ok: false, error: 'This link version is not supported. Ask the chat for a new link.' };

  const a = sp.get('a') ?? '';
  if (!(SIGN_ACTIONS as readonly string[]).includes(a)) return { ok: false, error: 'This link names an unknown action. Ask the chat for a new link.' };
  const action = a as SignAction;
  const allowed = new Set([...COMMON, ...PARAMS[action]]);
  const unknown = keys.filter((k) => !allowed.has(k));
  if (unknown.length) return { ok: false, error: `This link has a parameter this page does not accept (${unknown.slice(0, 3).join(', ').slice(0, 60)}). Ask the chat for a new link.` };

  const bad = (what: string): ParsedLink => ({ ok: false, error: `This link has a malformed value: ${what}. Ask the chat for a new link.` });
  const get = (k: string) => {
    const v = sp.get(k);
    return v === null || v.trim() === '' ? undefined : v.trim();
  };

  const ref = get('ref') ?? 'grok';
  if (!REF.test(ref)) return bad('ref');
  const client = get('c') ?? null;
  if (client !== null && !CLIENT.test(client)) return bad('c');
  const h = get('h') ?? null;
  if (h !== null && !/^[0-9a-fA-F]{12}$/.test(h)) return bad('h');
  // Return link: https:// only, same rule as the API's validReturnUrl. Anything else is rejected
  // with the link, so a bad return address can never smuggle the user somewhere unexpected.
  const r = get('r') ?? null;
  if (r !== null && validReturnUrlParam(r) === null) return bad('r');
  const f = get('f') ?? null;
  if (f !== null && !ADDR.test(f)) return bad('f');

  const linkAddresses: string[] = [];
  const addr = (k: string, required = true): string | undefined | null => {
    const v = get(k);
    if (v === undefined) return required ? null : undefined;
    if (!ADDR.test(v)) return null;
    linkAddresses.push(v);
    return v;
  };
  const slip = (): number | undefined | null => {
    const v = get('sl');
    if (v === undefined) return undefined;
    return intIn(v, 0, 10_000);
  };

  let path: string = action;
  const body: Record<string, unknown> = {};

  switch (action) {
    case 'buy': {
      const t = addr('t');
      if (!t) return bad('t');
      const amt = get('amt');
      if (!amt || !UINT.test(amt) || BigInt(amt) === 0n) return bad('amt');
      const sl = slip();
      if (sl === null) return bad('sl');
      Object.assign(body, { token: t, amountWei: amt }, sl !== undefined ? { slippageBps: sl } : {});
      break;
    }
    case 'sell': {
      const t = addr('t');
      if (!t) return bad('t');
      const amt = get('amt');
      const pct = get('pct');
      if ((amt === undefined) === (pct === undefined)) return bad('amt or pct (exactly one)');
      if (amt !== undefined) {
        if (!UINT.test(amt) || BigInt(amt) === 0n) return bad('amt');
        body.amount = amt;
      } else {
        const p = intIn(pct!, 1, 100);
        if (p === null) return bad('pct');
        body.percentOfBalance = p;
      }
      const sl = slip();
      if (sl === null) return bad('sl');
      body.token = t;
      if (sl !== undefined) body.slippageBps = sl;
      break;
    }
    case 'swap': {
      // path stays 'swap' -> POST /api/agents/v2/prepare/swap. The venue is
      // pinned in the link (ag) so the page rebuilds this same route.
      const ti = addr('ti');
      if (!ti) return bad('ti');
      const to = addr('to');
      if (!to) return bad('to');
      if (ti.toLowerCase() === to.toLowerCase()) return bad('ti and to are the same token');
      const amt = get('amt');
      if (!amt || !UINT.test(amt) || BigInt(amt) === 0n) return bad('amt');
      const sl = slip();
      if (sl === null) return bad('sl');
      const ag = get('ag');
      if (ag !== undefined && ag !== 'velora' && ag !== 'kyberswap' && ag !== 'bitget' && ag !== 'uniswap') return bad('ag');
      Object.assign(body, { tokenIn: ti, tokenOut: to, amountIn: amt }, sl !== undefined ? { slippageBps: sl } : {}, ag !== undefined ? { aggregator: ag } : {});
      break;
    }
    case 'nft-buy': {
      const l = intIn(get('l') ?? '', 1, 999_999_999);
      if (l === null) return bad('l');
      body.listingId = l;
      break;
    }
    case 'nft-mint': {
      path = 'nft-buy';
      const col = addr('col');
      if (!col) return bad('col');
      body.collection = col;
      const q = get('q');
      if (q !== undefined) {
        const n = intIn(q, 1, 50);
        if (n === null) return bad('q');
        body.quantity = n;
      }
      break;
    }
    case 'nft-create': {
      const n = get('n');
      const s = get('s');
      if (!n || n.length > 64) return bad('n');
      if (!s || s.length > 10) return bad('s');
      body.name = n;
      body.symbol = s;
      const img = get('img');
      if (!img || img.length > 512 || !/^(https:\/\/|ipfs:\/\/)/.test(img)) return bad('img');
      body.imageUri = img;
      const d = get('d');
      if (d !== undefined) {
        if (d.length > 500) return bad('d');
        body.description = d;
      }
      const bu = get('bu');
      if (bu !== undefined) {
        if (bu.length > 512 || !/^(https:\/\/|ipfs:\/\/)/.test(bu)) return bad('bu');
        body.baseURI = bu;
      }
      const ms = get('ms');
      if (ms !== undefined) {
        const x = intIn(ms, 1, 10_000);
        if (x === null) return bad('ms');
        body.maxSupply = x;
      }
      const mp = get('mp');
      if (mp !== undefined) {
        if (!UINT.test(mp)) return bad('mp');
        body.mintPriceWei = mp;
      }
      for (const [k, field, max] of [['rb', 'royaltyBps', 1500], ['mw', 'maxPerWallet', 1000], ['cw', 'commitWindow', 2_592_000], ['fb', 'floorBps', 5000]] as const) {
        const v = get(k);
        if (v === undefined) continue;
        const x = intIn(v, 0, max);
        if (x === null) return bad(k);
        body[field] = x;
      }
      break;
    }
    case 'fund-create': {
      const fx = get('fx');
      if (fx !== undefined) {
        if (fx !== 'phase6' && fx !== 'phase3') return bad('fx');
        body.factory = fx;
      }
      const tpl = get('tpl');
      if (tpl !== undefined) {
        const n = intIn(tpl, 1, 1000);
        if (n === null) return bad('tpl');
        body.templateId = n;
      }
      const n = get('n');
      const s = get('s');
      if (!n || n.length > 64) return bad('n');
      if (!s || s.length > 16) return bad('s');
      body.name = n;
      body.symbol = s;
      for (const [k, field] of [['mp', 'mintPriceWei'], ['rc', 'raiseCapWei']] as const) {
        const v = get(k);
        if (v === undefined) continue;
        if (!UINT.test(v)) return bad(k);
        body[field] = v;
      }
      for (const [k, field, max] of [['ef', 'entryFeeBps', 10_000], ['sk', 'minSkinBps', 10_000], ['rd', 'raiseDurationSeconds', 100_000_000]] as const) {
        const v = get(k);
        if (v === undefined) continue;
        const x = intIn(v, 0, max);
        if (x === null) return bad(k);
        body[field] = x;
      }
      for (const [k, field] of [['img', 'imageUri'], ['bu', 'baseURI']] as const) {
        const v = get(k);
        if (v === undefined) continue;
        if (v.length > 512 || !/^(https:\/\/|ipfs:\/\/)/.test(v)) return bad(k);
        body[field] = v;
      }
      break;
    }
    case 'fund-mint': {
      const fund = addr('fund');
      if (!fund) return bad('fund');
      body.fund = fund;
      const q = get('q');
      if (q !== undefined) {
        const n = intIn(q, 1, 10_000);
        if (n === null) return bad('q');
        body.quantity = n;
      }
      break;
    }
    case 'fund-redeem': {
      const fund = addr('fund');
      if (!fund) return bad('fund');
      body.fund = fund;
      const ids = get('ids');
      if (ids !== undefined) {
        if (!/^\d{1,40}(,\d{1,40}){0,199}$/.test(ids)) return bad('ids');
        body.ids = ids.split(',');
      }
      break;
    }
    case 'token-launch': {
      const p = get('p');
      if (!p || p.length > 12_000 || !/^[A-Za-z0-9_-]+$/.test(p)) return bad('p');
      const text = fromBase64Url(p);
      if (text === null) return bad('p');
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { return bad('p'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad('p');
      const obj = parsed as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        if (KEY_NAME.test(k) || k === 'from' || k === 'ref') {
          if (KEY_NAME.test(k)) return { ok: false, keyMaterial: true, error: 'This link contains a field that looks like a private key or seed phrase. It was ignored. Polypad never needs a private key or seed phrase, and nothing was sent.' };
          delete obj[k];
        }
      }
      Object.assign(body, obj);
      break;
    }
  }

  return { ok: true, action, path, body, ref, client, chatCode: h ? h.toLowerCase() : null, preparedFor: f, returnUrl: r, linkAddresses };
}
