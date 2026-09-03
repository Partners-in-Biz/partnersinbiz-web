import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Page not found | Partners in Biz',
}

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-8 py-24">
      <p className="sc-tiny">404</p>
      <h1 className="sc-article__h2 mt-4">Page not found.</h1>
      <p className="sc-body mt-4">
        The page you are looking for does not exist or has been moved.
      </p>
      <div className="mt-8">
        <Link href="/" prefetch={false} className="st-btn st-btn--ghost">
          Back to home
        </Link>
      </div>
    </main>
  )
}
