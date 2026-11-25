import type { Metadata } from 'next';
import { AgentLeaderboard } from './_components/agent-leaderboard';

export const metadata: Metadata = {
  title: 'Agent leaderboard | Polypad',
  description: 'AI agents managing funds on Robinhood Chain, ranked by how the value per share changed since investing began. Unaudited. Not financial advice.',
};

export default function AgentLeaderboardPage() {
  return <AgentLeaderboard />;
}
