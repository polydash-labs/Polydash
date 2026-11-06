/**
 * Off-chain Agent-launched mark.
 *
 * The deployed factory has no agent flag and its source stays Sourcify-identical.
 * A launch is marked by storing this exact URL in `socialLinks` (the factory
 * allows up to 10). The site reads that link back from the token and shows a
 * badge. It is a label for how the unsigned transaction was prepared, not a
 * review of the token.
 */

export const AGENT_LAUNCH_MARK = 'https://polypad.family/docs#agent-launched';

export const MAX_SOCIAL_LINKS = 10;

const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

export function isAgentLaunchMark(link: string): boolean {
  return link.trim() === AGENT_LAUNCH_MARK;
}

export function isAgentLaunched(links: readonly string[] | undefined | null): boolean {
  return (links ?? []).some((link) => isAgentLaunchMark(link));
}

/** `https://github.com/owner/repo`, without `.git`, a trailing slash, or a deeper path. */
export function normalizeRepository(input: string): string | null {
  let value = input.trim();
  if (value.endsWith('.git')) value = value.slice(0, -4);
  if (value.endsWith('/')) value = value.slice(0, -1);
  const match = GITHUB_REPO.exec(value);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
  return `https://github.com/${owner}/${repo}`;
}

export type PartitionedLinks = {
  agentLaunched: boolean;
  buildUrl: string | null;
  links: string[];
};

/** Split on-chain social links into the badge, the earliest GitHub repo, and the rest. */
export function partitionLaunchLinks(links: readonly string[] | undefined | null): PartitionedLinks {
  let buildUrl: string | null = null;
  const rest: string[] = [];
  for (const raw of links ?? []) {
    const link = typeof raw === 'string' ? raw.trim() : '';
    if (!link || isAgentLaunchMark(link)) continue;
    const repo = normalizeRepository(link);
    if (repo && !buildUrl) {
      buildUrl = repo;
      continue;
    }
    rest.push(link);
  }
  return { agentLaunched: isAgentLaunched(links), buildUrl, links: rest };
}

export type MarkedLinks = { links: string[]; error?: string };

/**
 * Append the agent mark when `enabled` and it is not already present.
 * Fails closed when the factory's 10-link cap would be exceeded.
 */
export function applyAgentMark(links: readonly string[], enabled: boolean): MarkedLinks {
  const cleaned = links.map((link) => link.trim()).filter(Boolean);
  if (!enabled || cleaned.some((link) => isAgentLaunchMark(link))) return { links: cleaned };
  if (cleaned.length >= MAX_SOCIAL_LINKS) {
    return {
      links: cleaned,
      error: `socialLinks already has ${MAX_SOCIAL_LINKS} entries. Remove one so the agent mark can be stored on the token.`,
    };
  }
  return { links: [...cleaned, AGENT_LAUNCH_MARK] };
}
