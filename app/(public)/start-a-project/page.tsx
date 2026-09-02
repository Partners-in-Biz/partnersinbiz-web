import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { bookACallHref } from '@/lib/marketing/stage-routes'

/**
 * The intake form is retired. Every "start a project" link lands on the
 * existing scheduler instead. A market hint is carried across when present.
 */

export const metadata: Metadata = {
  title: 'Book a 20-min call',
  robots: { index: false, follow: true },
  alternates: { canonical: '/book-a-call' },
}

export default async function StartProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string }>
}) {
  const params = await searchParams
  redirect(bookACallHref(params.market))
}
