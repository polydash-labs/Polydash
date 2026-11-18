// Build activity (phase 1): types, copy, message format and the health-score item. Pure; safe to import anywhere.
import type { HealthItem } from '@/lib/cto/chain';

export const BUILD_CHAIN_ID = 4663;
/** Health weight for Build activity (new, Oct 31 2026). Pending = neutral 7. */
export const BUILD_POINTS = 15;
export const BUILD_PENDING_POINTS = 7;
export const MAX_REPOS = 3;
export const MAX_WALLETS = 3;
export const NONCE_TTL_MS = 10 * 60_000;
export const EXPLORER = 'https://robinhoodchain.blockscout.com';

export const BUILD_DISCLAIMER = 'Build activity is based on public GitHub and on-chain data. It shows what was shipped, not whether it is free of risk. Scans are not audits. Not financial advice.';

export type BuildStatus = 'shipping' | 'slowing' | 'quiet' | 'none' | 'pending';
export const STATUS_LABEL: Record<BuildStatus, string> = { shipping: 'Shipping', slowing: 'Slowing', quiet: 'Quiet', none: 'No record', pending: 'Checking' };

export type ShipKind = 'commit' | 'batch' | 'release' | 'tag' | 'contract' | 'link' | 'unlink';
export interface ShipView { kind: ShipKind; title: string; url: string; at: string; filtered: boolean; reason: string | null }

export interface BuildFlag { id: string; label: string; detail: string }

export interface BuildRepoView { fullName: string; url: string; proof: 'signature' | 'confirmed'; archived: boolean; fork: boolean; createdAt: string | null; linkedAt: string }
export interface BuildWalletView { address: string; linkedAt: string }

export interface BuildMetrics {
  lastCommitAt: string | null; lastShipAt: string | null;
  commits7: number; commits30: number; contributors: number;
  contracts: number; contractsVerified: number; releases90: number;
  parts: { code: number; releases: number; onchain: number; contributors: number; decay: number; cap: number; raw: number };
}

export interface BuildView {
  status: BuildStatus;
  earned: number;
  pending: boolean;
  partial: boolean;
  updatedAt: string | null;
  metrics: BuildMetrics | null;
  flags: BuildFlag[];
  repos: BuildRepoView[];
  wallets: BuildWalletView[];
  ships: ShipView[];
  filtered: ShipView[];
  filteredCount: number;
  heyUrl: string | null;
}

export const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** Accepts "owner/name" or a github.com URL. Returns "owner/name" or null. */
export function parseRepo(input: string): string | null {
  let s = String(input ?? '').trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  s = s.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
  const parts = s.split('/').slice(0, 2).join('/');
  return REPO_RE.test(parts) && !parts.endsWith('/.') && !parts.endsWith('/..') ? parts : null;
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/** Normalises the target of a Build activity action (repo "owner/name" or lowercase wallet). Null when invalid. */
export function normaliseValue(action: string, raw: unknown): string | null {
  if (action.endsWith('repo')) return parseRepo(String(raw ?? ''));
  const s = String(raw ?? '').trim();
  return ADDR_RE.test(s) ? s.toLowerCase() : null;
}

export type BuildAction = 'link_repo' | 'unlink_repo' | 'link_wallet' | 'unlink_wallet';
export const ACTION_LABEL: Record<BuildAction, string> = { link_repo: 'Link GitHub repo', unlink_repo: 'Unlink GitHub repo', link_wallet: 'Link deployer wallet', unlink_wallet: 'Unlink deployer wallet' };

/** EIP-191 message the creator (or an extra deployer wallet) signs. Server rebuilds it to verify. */
export function buildMessage(p: { action: BuildAction; token: string; launch: string; value: string; nonce: string; expires: string }): string {
  const target = p.action.endsWith('repo') ? `Repo: github.com/${p.value}` : `Wallet: ${p.value.toLowerCase()}`;
  return [
    'Polypad Build activity',
    `Action: ${ACTION_LABEL[p.action]}`,
    `Token: ${p.token.toLowerCase()}`,
    `Launch: ${p.launch.toLowerCase()}`,
    `Chain: ${BUILD_CHAIN_ID}`,
    target,
    `Nonce: ${p.nonce}`,
    `Expires: ${p.expires}`,
    '',
    'Signing is free and sends no transaction.',
  ].join('\n');
}

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86_400 * 60) return `${Math.round(s / 86_400)}d ago`;
  return `${Math.round(s / (86_400 * 30))}mo ago`;
}

/** One-line summary, e.g. "Shipping · last ship 3d ago". */
export function buildLine(v: Pick<BuildView, 'status' | 'metrics'> | null, now = Date.now()): string {
  if (!v || v.status === 'pending') return 'Checking';
  if (v.status === 'none') return 'No record';
  return `${STATUS_LABEL[v.status]} · last ship ${timeAgo(v.metrics?.lastShipAt ?? null, now)}`;
}

export type BuildScoreView = Pick<BuildView, 'pending' | 'earned' | 'status' | 'metrics'>;

export function buildItem(v: BuildScoreView | null): HealthItem {
  const base = { key: 'build', points: BUILD_POINTS };
  if (!v || v.pending) return { ...base, label: 'Build activity (checking, neutral for now)', ok: true, known: false, earned: BUILD_PENDING_POINTS };
  const earned = Math.max(0, Math.min(BUILD_POINTS, Math.round(v.earned)));
  return { ...base, label: `Build activity (${buildLine(v)})`, ok: earned > 0, known: true, earned };
}
