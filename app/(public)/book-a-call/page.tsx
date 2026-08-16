import type { Metadata } from 'next'
import { SITE } from '@/lib/seo/site'
import BookingWidget from './BookingWidget'
import { marketFromId } from '@/lib/seo/market-offers'

export const metadata: Metadata = {
  title: 'Book a 20-min Intro Call | Partners in Biz',
  description: 'Pick a time and book a free 20-minute intro call with Peet at Partners in Biz.',
  alternates: { canonical: '/book-a-call' },
  openGraph: {
    title: 'Book a 20-min Intro Call | Partners in Biz',
    description: 'Pick a time and book a free 20-minute intro call with Peet at Partners in Biz.',
    url: `${SITE.url}/book-a-call`,
  },
}

export default async function BookACallPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string }>
}) {
  const params = await searchParams
  const market = marketFromId(params.market)

  return (
    <main className="pt-28 pb-24 px-4">
      <div className="max-w-xl mx-auto space-y-8">
        <div className="space-y-3">
          <span className="eyebrow">{market ? 'The 4-Week Site' : 'Free intro call'}</span>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Book a 20-min call
          </h1>
          <p className="text-[var(--color-pib-text-muted)] leading-relaxed">
            {market
              ? `No sales pitch. We\u2019ll confirm fit for the ${market.priceDisplay} / 28-day site, then you start on Stripe.`
              : 'No sales pitch. We\u2019ll talk through what you\u2019re building, whether we\u2019re the right fit, and what a realistic scope and timeline looks like.'}
          </p>
        </div>

        <BookingWidget />

        <p className="text-xs text-[var(--color-pib-text-faint)] text-center">
          {market
            ? market.overlapShort.replace('WhatsApp · ', '')
            : 'All times in SAST (UTC+2) · Mon–Fri · 09:00–17:00'}
        </p>
      </div>
    </main>
  )
}
