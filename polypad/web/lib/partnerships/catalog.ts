// Partner catalog PDF — generated on request at /api/partnerships/catalog.
// Black + emerald branded cover, clean Helvetica body. Shares the content
// data with the partnerships page (lib/partnerships/data.ts) so the catalog
// and the page can never drift apart.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  BETTER,
  CAPABILITIES,
  COMPARISON_ROWS,
  HERO,
  INTEGRATION_PATHS,
  NUMBERS,
  OFFERINGS,
  PARTNER_EMAIL,
  PARTNERSHIPS_URL,
  PROCESS,
  WHY_PARTNER,
  PARTNERSHIP_TYPES,
  FINE_PRINT,
} from './data';

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

const BLACK = rgb(0.02, 0.04, 0.03);
const INK = rgb(0.1, 0.12, 0.11);
const MUTED = rgb(0.38, 0.42, 0.4);
const EMERALD = rgb(0, 0.75, 0.42);
const EMERALD_DARK = rgb(0, 0.55, 0.3);
const LINE = rgb(0.88, 0.9, 0.89);
const ROW_BG = rgb(0.96, 0.98, 0.97);

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Helvetica (WinAnsi) has no checkmark glyph, so checkmarks are drawn as
// two vector strokes, and "not live" as an empty square outline.
function drawCheck(page: PDFPage, x: number, y: number, size: number, color: ReturnType<typeof rgb>) {
  const s = size;
  page.drawLine({ start: { x: x + s * 0.1, y: y + s * 0.45 }, end: { x: x + s * 0.4, y: y + s * 0.15 }, thickness: 1.6, color });
  page.drawLine({ start: { x: x + s * 0.4, y: y + s * 0.15 }, end: { x: x + s * 0.95, y: y + s * 0.85 }, thickness: 1.6, color });
}

function drawEmptyBox(page: PDFPage, x: number, y: number, size: number, color: ReturnType<typeof rgb>) {
  page.drawRectangle({ x, y, width: size, height: size, borderColor: color, borderWidth: 1 });
}

type Ctx = {
  doc: PDFDocument;
  body: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
  pageNo: number;
};

function newPage(ctx: Ctx, footer = true) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pageNo += 1;
  ctx.y = PAGE_H - MARGIN;
  if (footer && ctx.pageNo > 1) {
    ctx.page.drawText('POLYPAD  ·  PARTNER CATALOG', {
      x: MARGIN,
      y: 34,
      size: 7.5,
      font: ctx.bold,
      color: MUTED,
    });
    ctx.page.drawText(`${PARTNERSHIPS_URL}`, {
      x: MARGIN,
      y: 22,
      size: 7.5,
      font: ctx.body,
      color: MUTED,
    });
    ctx.page.drawText(`${ctx.pageNo}`, {
      x: PAGE_W - MARGIN - 12,
      y: 34,
      size: 8,
      font: ctx.body,
      color: MUTED,
    });
  }
  return ctx.page;
}

function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 24) newPage(ctx);
}

function text(ctx: Ctx, str: string, size: number, font: PDFFont, color = INK, gap = 4) {
  const lines = wrap(font, str, size, CONTENT_W);
  ensure(ctx, lines.length * (size + gap) + 2);
  for (const line of lines) {
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size, font, color });
    ctx.y -= size + gap;
  }
  return ctx.y;
}

function sectionTitle(ctx: Ctx, title: string, sub?: string) {
  ensure(ctx, 64);
  ctx.y -= 6;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y + 2, width: 26, height: 3, color: EMERALD });
  ctx.y -= 18;
  ctx.page.drawText(title, { x: MARGIN, y: ctx.y, size: 17, font: ctx.bold, color: BLACK });
  ctx.y -= 24;
  if (sub) {
    text(ctx, sub, 10.5, ctx.body, MUTED, 5);
    ctx.y -= 4;
  }
}

function bullet(ctx: Ctx, title: string, body?: string) {
  const size = 10.5;
  const lines = wrap(ctx.body, body ? `${title} — ${body}` : title, size, CONTENT_W - 16);
  ensure(ctx, lines.length * (size + 4) + 6);
  ctx.page.drawText('•', { x: MARGIN, y: ctx.y, size, font: ctx.bold, color: EMERALD_DARK });
  let first = true;
  for (const line of lines) {
    if (first) {
      // Bold the title part of the first line.
      const titleW = ctx.bold.widthOfTextAtSize(title, size);
      if (titleW + 6 <= CONTENT_W - 16) {
        ctx.page.drawText(title, { x: MARGIN + 14, y: ctx.y, size, font: ctx.bold, color: INK });
        const rest = line.slice(title.length).replace(/^ —\s?/, '— ');
        if (rest.trim()) {
          ctx.page.drawText(rest, { x: MARGIN + 14 + titleW, y: ctx.y, size, font: ctx.body, color: INK });
        }
      } else {
        ctx.page.drawText(line, { x: MARGIN + 14, y: ctx.y, size, font: ctx.body, color: INK });
      }
      first = false;
    } else {
      ctx.page.drawText(line, { x: MARGIN + 14, y: ctx.y, size, font: ctx.body, color: INK });
    }
    ctx.y -= size + 4;
  }
  ctx.y -= 2;
}

export async function buildCatalogPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { doc, body, bold, page: doc.addPage([PAGE_W, PAGE_H]), y: 0, pageNo: 0 };
  ctx.pageNo = 1;

  // ---- Cover: full black page, emerald accents ----
  const cover = ctx.page;
  cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: BLACK });
  cover.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: EMERALD });
  cover.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 8, color: EMERALD });
  cover.drawText('POLYPAD', { x: MARGIN, y: PAGE_H - 92, size: 15, font: bold, color: rgb(1, 1, 1) });
  cover.drawText('The premiere agentic marketplace · Robinhood Chain', {
    x: MARGIN,
    y: PAGE_H - 114,
    size: 10,
    font: body,
    color: rgb(0.75, 0.8, 0.77),
  });
  let cy = PAGE_H - 260;
  cover.drawText('Partner with', { x: MARGIN, y: cy, size: 44, font: bold, color: rgb(1, 1, 1) });
  cy -= 52;
  cover.drawText('Polypad', { x: MARGIN, y: cy, size: 44, font: bold, color: EMERALD });
  cy -= 40;
  cover.drawRectangle({ x: MARGIN, y: cy + 8, width: 64, height: 3, color: EMERALD });
  cy -= 34;
  for (const line of wrap(body, HERO.valueProp, 13, CONTENT_W)) {
    cover.drawText(line, { x: MARGIN, y: cy, size: 13, font: body, color: rgb(0.88, 0.92, 0.9) });
    cy -= 21;
  }
  cy -= 30;
  cover.drawText('PARTNER CATALOG  ·  NOVEMBER 2026', { x: MARGIN, y: cy, size: 10, font: bold, color: rgb(0.75, 0.8, 0.77) });
  cy -= 22;
  cover.drawText(PARTNERSHIPS_URL, { x: MARGIN, y: cy, size: 10, font: body, color: EMERALD });
  cy -= 22;
  cover.drawText(`Contact: ${PARTNER_EMAIL}`, { x: MARGIN, y: cy, size: 10, font: body, color: rgb(0.75, 0.8, 0.77) });

  // ---- Page 2: Why partner + numbers ----
  newPage(ctx);
  sectionTitle(ctx, 'Why partner with Polypad', 'One integration gives your product the whole agentic stack — wallets, funds, launches, staking, and pay-per-call.');
  for (const w of WHY_PARTNER) bullet(ctx, w.title, w.body);
  ctx.y -= 6;
  sectionTitle(ctx, 'Polypad in numbers');
  for (const n of NUMBERS) {
    ensure(ctx, 30);
    ctx.page.drawText(n.value, { x: MARGIN, y: ctx.y, size: 15, font: bold, color: EMERALD_DARK });
    ctx.page.drawText(`${n.label} — ${n.note}`, { x: MARGIN + 86, y: ctx.y + 1, size: 10.5, font: body, color: INK });
    ctx.y -= 26;
  }

  // ---- What we offer ----
  ctx.y -= 4;
  sectionTitle(ctx, 'What we offer partners');
  for (const o of OFFERINGS) bullet(ctx, o.title, o.body);

  // ---- Integration paths ----
  sectionTitle(ctx, 'Integration paths', 'Three ways in. Pick the one that fits your stack — they all reach the same tools, and you sign everything.');
  for (const p of INTEGRATION_PATHS) {
    ensure(ctx, 90);
    ctx.page.drawText(p.name, { x: MARGIN, y: ctx.y, size: 13, font: bold, color: BLACK });
    ctx.page.drawText(p.tag, { x: MARGIN + 170, y: ctx.y + 1, size: 10, font: body, color: MUTED });
    ctx.y -= 20;
    for (const step of p.steps) bullet(ctx, step);
    ctx.y -= 2;
  }
  text(ctx, 'MCP endpoint: https://polypad.family/api/mcp  ·  SDK: polypad-agent v2.0.1 (npm + PyPI)  ·  REST API v2 with Pro keys.', 10, body, MUTED, 5);

  // ---- Partnership types ----
  sectionTitle(ctx, 'Partnership types');
  for (const t of PARTNERSHIP_TYPES) {
    ensure(ctx, 100);
    ctx.page.drawText(t.name, { x: MARGIN, y: ctx.y, size: 13, font: bold, color: BLACK });
    ctx.y -= 18;
    text(ctx, t.tagline, 10.5, body, MUTED, 5);
    for (const inc of t.includes) bullet(ctx, inc);
    text(ctx, `Best for: ${t.bestFor}`, 10, body, MUTED, 5);
    ctx.y -= 4;
  }

  // ---- Comparison grid ----
  sectionTitle(ctx, 'What each partnership includes', 'A check means included. “Add-on” means available as part of that partnership.');
  const colW = 62;
  const firstCol = CONTENT_W - colW * 5;
  ensure(ctx, 40);
  const headerY = ctx.y;
  ctx.page.drawText('Included', { x: MARGIN, y: headerY, size: 9, font: bold, color: MUTED });
  PARTNERSHIP_TYPES.forEach((t, i) => {
    const label = t.name.length > 9 ? t.name.slice(0, 9) : t.name;
    ctx.page.drawText(label, { x: MARGIN + firstCol + i * colW, y: headerY, size: 8.5, font: bold, color: INK });
  });
  ctx.y -= 16;
  COMPARISON_ROWS.forEach((row, ri) => {
    ensure(ctx, 22);
    if (ri % 2 === 0) {
      ctx.page.drawRectangle({ x: MARGIN - 6, y: ctx.y - 3, width: CONTENT_W + 12, height: 18, color: ROW_BG });
    }
    const labelLines = wrap(body, row.feature, 9.5, firstCol - 8);
    ctx.page.drawText(labelLines[0], { x: MARGIN, y: ctx.y, size: 9.5, font: body, color: INK });
    row.values.forEach((v, i) => {
      const cx = MARGIN + firstCol + i * colW;
      if (v === true) {
        drawCheck(ctx.page, cx + 2, ctx.y - 1, 10, EMERALD_DARK);
      } else {
        const val = v === false ? '—' : String(v);
        ctx.page.drawText(val, {
          x: cx,
          y: ctx.y,
          size: 9,
          font: body,
          color: MUTED,
        });
      }
    });
    ctx.y -= 20;
  });
  ctx.y -= 6;

  // ---- Capabilities checklist ----
  sectionTitle(ctx, 'Capabilities checklist', 'Everything your agents can do on Polypad — and how each one connects. 27 MCP tools · 5 agent skills · chain id 4663.');
  for (const g of CAPABILITIES) {
    ensure(ctx, 40);
    ctx.page.drawText(g.group, { x: MARGIN, y: ctx.y, size: 12.5, font: bold, color: BLACK });
    ctx.y -= 18;
    for (const row of g.rows) {
      const label = row.live ? row.label : `${row.label}  [Built — not live]`;
      const lines = wrap(body, `${label} — ${row.detail} (${row.route})`, 10, CONTENT_W - 16);
      ensure(ctx, lines.length * 14 + 4);
      if (row.live) drawCheck(ctx.page, MARGIN, ctx.y - 1, 11, EMERALD_DARK);
      else drawEmptyBox(ctx.page, MARGIN + 1, ctx.y - 1, 10, MUTED);
      for (const line of lines) {
        ctx.page.drawText(line, { x: MARGIN + 16, y: ctx.y, size: 10, font: body, color: INK });
        ctx.y -= 14;
      }
      ctx.y -= 2;
    }
    ctx.y -= 4;
  }

  // ---- How we make your project better ----
  sectionTitle(ctx, 'How we make your project better');
  for (const b of BETTER) {
    ensure(ctx, 60);
    ctx.page.drawText(b.title, { x: MARGIN, y: ctx.y, size: 12, font: bold, color: BLACK });
    ctx.y -= 18;
    text(ctx, `Before: ${b.before}`, 10, body, MUTED, 4);
    text(ctx, `After: ${b.after}`, 10, body, INK, 4);
    ctx.y -= 4;
  }

  // ---- Process + free compute + contact ----
  sectionTitle(ctx, 'How it works');
  PROCESS.forEach((p, i) => {
    ensure(ctx, 34);
    ctx.page.drawText(`${i + 1}. ${p.step}`, { x: MARGIN, y: ctx.y, size: 11.5, font: bold, color: BLACK });
    ctx.y -= 17;
    text(ctx, p.body, 10, body, MUTED, 4);
    ctx.y -= 2;
  });
  ctx.y -= 4;
  sectionTitle(ctx, 'Free compute for strategic partners');
  text(ctx, 'Strategic partners get free compute to build and run on Polypad. Apply through the form at polypad.family/build/partnerships and tell us what you are building.', 10.5, body, INK, 5);
  ctx.y -= 4;
  sectionTitle(ctx, 'Talk to us');
  text(ctx, `Partnership inquiries: ${PARTNER_EMAIL}`, 11, bold, INK, 5);
  text(ctx, `Site: ${PARTNERSHIPS_URL}`, 11, body, INK, 5);
  text(ctx, 'Or use the form on the partnerships page — every submission goes straight to the Polypad team.', 10.5, body, MUTED, 5);
  ctx.y -= 10;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y + 4, width: CONTENT_W, height: 1, color: LINE });
  ctx.y -= 12;
  for (const line of wrap(body, FINE_PRINT, 8.5, CONTENT_W)) {
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size: 8.5, font: body, color: MUTED });
    ctx.y -= 13;
  }

  return doc.save();
}
