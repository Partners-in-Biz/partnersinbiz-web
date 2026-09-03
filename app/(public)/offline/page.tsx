import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Offline',
  description: 'You are offline. Reconnect to keep working with Partners in Biz.',
  robots: { index: false, follow: false },
}

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-8 py-24">
      <p className="sc-tiny">Offline</p>
      <h1 className="sc-article__h2 mt-4">You are offline.</h1>
      <p className="sc-body mt-4">
        This page is served from your device cache, so reconnect to load anything new.
      </p>
      <div className="mt-8">
        <Link href="/" prefetch={false} className="st-btn st-btn--ghost">
          Try home page
        </Link>
      </div>
    </main>
  )
}
