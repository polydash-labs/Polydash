'use client';

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { formatCompact } from '@/lib/format';

export type ChartPoint = { date: string; ethIn: number; ethSpent: number; polyBurned: number; polyToStakers: number };

const axis = 'rgba(255,255,255,0.35)';
const LABELS: Record<string, string> = {
  ethIn: 'ETH received',
  ethSpent: 'ETH spent',
  polyBurned: 'POLYDASH burned',
  polyToStakers: 'POLYDASH for stakers',
};

export default function BuybackChartInner({ data }: { data: ChartPoint[] }) {
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={30} tick={{ fontSize: 10, fill: axis }} />
          <YAxis yAxisId="eth" tickLine={false} axisLine={false} width={48} tick={{ fontSize: 10, fill: axis }} tickFormatter={(v: number) => `${formatCompact(v)} Ξ`} />
          <YAxis yAxisId="poly" orientation="right" tickLine={false} axisLine={false} width={56} tick={{ fontSize: 10, fill: axis }} tickFormatter={(v: number) => formatCompact(v)} />
          <Tooltip
            contentStyle={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 11, color: '#fff' }}
            formatter={(value: any, name: any) => [formatCompact(Number(value)), LABELS[String(name)] ?? String(name)]}
          />
          <Legend formatter={(v: any) => <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{LABELS[String(v)] ?? String(v)}</span>} />
          <Line yAxisId="eth" type="stepAfter" dataKey="ethIn" stroke="rgba(255,255,255,0.75)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line yAxisId="eth" type="stepAfter" dataKey="ethSpent" stroke="rgba(255,255,255,0.35)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line yAxisId="poly" type="stepAfter" dataKey="polyBurned" stroke="#00E676" strokeWidth={1.75} dot={false} isAnimationActive={false} />
          <Line yAxisId="poly" type="stepAfter" dataKey="polyToStakers" stroke="#00E676" strokeOpacity={0.5} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
