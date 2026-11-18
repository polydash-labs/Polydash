// Creator profile shape + validation. Isomorphic (used by the manage form and the write API).
export const TONES = ['friendly', 'professional', 'hype-free degen'] as const;
export type Tone = (typeof TONES)[number];
export interface Socials { x: string; telegram: string; website: string; other: string }
export interface Faq { q: string; a: string }
export interface ProfileInput { tone: Tone; socials: Socials; faqs: Faq[]; plan: string }

export const LIMITS = { url: 200, q: 200, a: 1000, plan: 2000, faqs: 20 };
export const SOCIAL_LABELS: Record<keyof Socials, string> = { x: 'X', telegram: 'Telegram', website: 'Website', other: 'Other link' };

const clean = (v: unknown, max: number) =>
  String(typeof v === 'string' ? v : '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/[<>]/g, '').trim().slice(0, max);

export function isHttpUrl(v: string) {
  try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
}

export function validateProfile(body: any): { ok: true; data: ProfileInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const tone = TONES.includes(body?.tone) ? (body.tone as Tone) : null;
  if (!tone) errors.push('Pick a tone.');
  const socials = { x: '', telegram: '', website: '', other: '' } as Socials;
  for (const k of Object.keys(socials) as (keyof Socials)[]) {
    const raw = String(body?.socials?.[k] ?? '').trim();
    if (raw.length > LIMITS.url) { errors.push(`${SOCIAL_LABELS[k]} link is too long (max ${LIMITS.url}).`); continue; }
    const v = clean(raw, LIMITS.url);
    if (v && !isHttpUrl(v)) errors.push(`${SOCIAL_LABELS[k]} must be an http(s) link.`);
    socials[k] = v;
  }
  const rawFaqs = Array.isArray(body?.faqs) ? body.faqs : [];
  if (rawFaqs.length > LIMITS.faqs) errors.push(`Up to ${LIMITS.faqs} FAQs.`);
  const faqs: Faq[] = [];
  rawFaqs.slice(0, LIMITS.faqs).forEach((f: any, i: number) => {
    const q = clean(f?.q, LIMITS.q + 1), a = clean(f?.a, LIMITS.a + 1);
    if (!q && !a) return;
    if (!q || !a) errors.push(`FAQ ${i + 1} needs both a question and an answer.`);
    if (q.length > LIMITS.q) errors.push(`FAQ ${i + 1} question is too long (max ${LIMITS.q}).`);
    if (a.length > LIMITS.a) errors.push(`FAQ ${i + 1} answer is too long (max ${LIMITS.a}).`);
    faqs.push({ q: q.slice(0, LIMITS.q), a: a.slice(0, LIMITS.a) });
  });
  const planRaw = typeof body?.plan === 'string' ? body.plan : '';
  if (planRaw.length > LIMITS.plan) errors.push(`Plan is limited to ${LIMITS.plan} characters.`);
  const plan = clean(planRaw, LIMITS.plan);
  if (errors.length || !tone) return { ok: false, errors };
  return { ok: true, data: { tone, socials, faqs, plan } };
}

export const emptyProfile = (): ProfileInput => ({ tone: 'friendly', socials: { x: '', telegram: '', website: '', other: '' }, faqs: [], plan: '' });
