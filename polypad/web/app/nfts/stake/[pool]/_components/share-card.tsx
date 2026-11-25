'use client';

import { useEffect, useRef } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SHARE_FOOTER } from '@/lib/nftStaking';

export interface ShareData { collection: string; poolName: string; staked: number; tier: string; setBonus: string; url: string }

function draw(cv: HTMLCanvasElement, d: ShareData) {
  const W = 1200, H = 630;
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0A0A0A'); bg.addColorStop(1, '#0F1A14');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,230,118,0.08)';
  g.beginPath(); g.arc(W - 120, 90, 260, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#00E676'; g.fillRect(72, 72, 44, 4);
  const font = (w: number, s: number) => `${w} ${s}px Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
  g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = font(500, 26); g.fillText('POLYPAD  NFT STAKING', 72, 128);
  const fit = (t: string, max: number, size: number, w = 700) => { let s = size; g.font = font(w, s); while (g.measureText(t).width > max && s > 24) { s -= 2; g.font = font(w, s); } return s; };
  g.fillStyle = '#FFFFFF'; fit(d.collection, W - 144, 72); g.fillText(d.collection, 72, 225);
  g.fillStyle = 'rgba(255,255,255,0.7)'; fit(d.poolName, W - 144, 32, 500); g.fillText(d.poolName, 72, 280);
  const stats: [string, string][] = [['NFTs staked', String(d.staked)], ['Boost tier', d.tier], ['Set bonus', d.setBonus]];
  stats.forEach(([k, v], i) => {
    const x = 72 + i * 352, y = 340;
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.beginPath(); (g as any).roundRect ? (g as any).roundRect(x, y, 330, 150, 20) : g.rect(x, y, 330, 150); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = font(500, 24); g.fillText(k, x + 28, y + 50);
    g.fillStyle = '#FFFFFF'; fit(v, 280, 52); g.fillText(v, x + 28, y + 115);
  });
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = font(400, 22); g.fillText(SHARE_FOOTER, 72, H - 64);
  g.fillStyle = '#00E676'; g.font = font(600, 22);
  const brand = 'polypad.family'; g.fillText(brand, W - 72 - g.measureText(brand).width, H - 64);
}

export function ShareCard({ data }: { data: ShareData }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) draw(ref.current, data); }, [data]);

  const download = () => {
    const cv = ref.current;
    if (!cv) return;
    try {
      const a = document.createElement('a');
      a.href = cv.toDataURL('image/png');
      a.download = `polypad-nft-staking-${data.collection.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { console.error('share card download failed', e); }
  };

  const text = `Staking ${data.staked} ${data.collection} NFT${data.staked === 1 ? '' : 's'} on Polypad. Boost: ${data.tier}. ${SHARE_FOOTER}`;
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(data.url)}`;

  return (
    <section className="glass-card space-y-3 p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold text-white">Share card</h2>
      <canvas ref={ref} className="aspect-[1200/630] w-full rounded-xl ring-1 ring-white/10" aria-label="Share card preview" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="rounded-full" onClick={download}><Download className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />Download image</Button>
        <Button asChild size="sm" variant="outline" className="rounded-full"><a href={intent} target="_blank" rel="noopener noreferrer">Post on X</a></Button>
      </div>
    </section>
  );
}
