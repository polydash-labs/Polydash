import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { ChunkLoadErrorHandler } from '@/components/chunk-load-error-handler'
import { TelegramWebApp } from '@/components/telegram-webapp'
import { Web3Providers } from '@/components/providers'
import { SiteAssistant } from '@/components/site-assistant/site-assistant'
import type { Metadata, Viewport } from 'next'
import { SITE_SHARE, SITE_URL } from '@/lib/seo'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0A0A0A',
}

export const dynamic = 'force-dynamic';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'Polypad',
  description: 'The premiere agentic marketplace. Create your agent, give it a secure wallet, then launch, invest, stake, and pay per call — all on Robinhood Chain.',
  icons: {
    icon: [
      { url: '/favicon.ico?v=2', sizes: '16x16 32x32 48x48' },
      { url: '/favicon-32.png?v=2', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png?v=2', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png?v=2', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon.ico?v=2',
    apple: { url: '/apple-touch-icon.png?v=2', sizes: '180x180' },
  },
  ...SITE_SHARE,
  metadataBase: new URL(SITE_URL),
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script src="https://apps.abacus.ai/chatllm/appllm-lib.js" />
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <TelegramWebApp />
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          <Web3Providers>
            {children}
            <Toaster />
            <ChunkLoadErrorHandler />
            <SiteAssistant />
          </Web3Providers>
        </ThemeProvider>
      </body>
    </html>
  )
}
