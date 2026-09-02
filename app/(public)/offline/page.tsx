import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Offline',
  description: 'You are offline. Reconnect to keep working with Partners in Biz.',
  robots: { index: false, follow: false },
}

export default function OfflinePage() {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-6 py-24">
      <div className="max-w-lg text-center space-y-6">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--pib-accent)]">
          You&apos;re offline
        </p>
        <h1 className="font-display text-4xl sm:text-5xl leading-tight">
          We&apos;ll be back the moment your signal is.
        </h1>
        <p className="text-base text-[var(--pib-muted)]">
          This page is being served from your device cache. Recently visited pages should still
          work, reconnect to load anything new.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--pib-accent)] text-black px-5 py-2.5 text-sm font-medium"
          >
            Try home page
          </Link>
          <a
            href="javascript:location.reload()"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm"
          >
            Retry
          </a>
        </div>
      </div>
    </main>
  )
}
