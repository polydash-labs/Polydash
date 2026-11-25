'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Telegram Mini App integration (t.me/Aipolyagent_Bot/Polypad).
 * Every call is guarded: in a normal browser `window.Telegram` is undefined
 * and this component is a complete no-op — the site works exactly as before.
 * The Telegram WebApp script is loaded in the <head> (see app/layout.tsx).
 * Signing, the MCP API and contracts are untouched by this component.
 */

type TelegramThemeParams = Record<string, string | undefined>;

interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  colorScheme: 'light' | 'dark';
  themeParams: TelegramThemeParams;
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  onEvent?: (event: string, cb: () => void) => void;
  offEvent?: (event: string, cb: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** '#rrggbb' -> 'H S% L%' for the site's HSL CSS variables. Null if not a 6-digit hex. */
function hexToHslTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return `0 0% ${Math.round(l * 100)}%`;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Map Telegram's theme onto the site's CSS variables.
 * Polypad is a dark-only brand (forced dark theme, many hardcoded dark
 * surfaces), so the variable mapping only applies in Telegram dark mode,
 * where it maps cleanly. In Telegram light mode the site keeps its dark
 * theme — a full light theme pass is a separate job — and only the Telegram
 * chrome (header/background) is set to the site's dark background so it
 * blends instead of clashing.
 */
function applyTelegramTheme(wa: TelegramWebApp) {
  const root = document.documentElement;
  const p = wa.themeParams ?? {};
  if (wa.colorScheme === 'dark') {
    const set = (cssVar: string, key: string) => {
      const v = p[key];
      if (!v) return;
      const hsl = hexToHslTriplet(v);
      if (hsl) root.style.setProperty(cssVar, hsl);
    };
    set('--background', 'bg_color');
    set('--foreground', 'text_color');
    set('--card', 'secondary_bg_color');
    set('--card-foreground', 'text_color');
    set('--popover', 'secondary_bg_color');
    set('--popover-foreground', 'text_color');
    set('--primary', 'button_color');
    set('--primary-foreground', 'button_text_color');
    set('--accent', 'button_color');
    set('--accent-foreground', 'button_text_color');
    set('--muted-foreground', 'hint_color');
    set('--ring', 'button_color');
    root.style.colorScheme = 'dark';
    try {
      wa.setHeaderColor?.(p.bg_color ?? '#0A0A0A');
    } catch {}
    try {
      wa.setBackgroundColor?.(p.bg_color ?? '#0A0A0A');
    } catch {}
  } else {
    root.style.colorScheme = 'dark';
    try {
      wa.setHeaderColor?.('#0A0A0A');
    } catch {}
    try {
      wa.setBackgroundColor?.('#0A0A0A');
    } catch {}
  }
}

export function TelegramWebApp() {
  const pathname = usePathname();
  const router = useRouter();

  // ready() + expand() on load, theme sync (re-applied on themeChanged).
  useEffect(() => {
    const wa = window.Telegram?.WebApp;
    if (!wa) return;
    try {
      wa.ready();
    } catch {}
    try {
      wa.expand();
    } catch {}
    applyTelegramTheme(wa);
    const onThemeChanged = () => applyTelegramTheme(wa);
    wa.onEvent?.('themeChanged', onThemeChanged);
    return () => {
      wa.offEvent?.('themeChanged', onThemeChanged);
    };
  }, []);

  // Back button: hidden on home, shown on sub-pages, wired to router back.
  useEffect(() => {
    const wa = window.Telegram?.WebApp;
    if (!wa) return;
    const onBack = () => router.back();
    if (pathname === '/') wa.BackButton.hide();
    else wa.BackButton.show();
    wa.BackButton.onClick(onBack);
    return () => {
      wa.BackButton.offClick(onBack);
    };
  }, [pathname, router]);

  return null;
}
