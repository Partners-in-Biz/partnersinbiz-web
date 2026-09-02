import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { SITE } from '@/lib/seo/site'
import BookingWidget from './BookingWidget'
import { marketFromId } from '@/lib/seo/market-offers'
import { STAGE_STILLS, CTA_TEXT } from '@/lib/marketing/stage-content'
import { MarketLinks, Wordmark } from '@/components/marketing/stage/StageChrome'
import '@/components/marketing/stage/stage.css'

export const metadata: Metadata = {
  title: 'Book a 20-min call',
  description: 'Pick a time. Twenty minutes with Peet at Partners in Biz. No sales pitch.',
  alternates: { canonical: '/book-a-call' },
  openGraph: {
    title: 'Book a 20-min call | Partners in Biz',
    description: 'Pick a time. Twenty minutes with Peet at Partners in Biz. No sales pitch.',
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
  const isUs = market?.id === 'us'
  const homeHref = isUs ? '/us' : '/'
  const waHref = `https://wa.me/${SITE.whatsapp.replace(/\D/g, '')}`

  const eyebrow = market ? 'The 4-Week Site' : 'A site that makes the phone ring'
  const dek = isUs
    ? 'No sales pitch. We confirm fit for the 4-Week Site and the 90-Day Fill, then you start on Stripe.'
    : market
      ? `No sales pitch. We confirm fit for the ${market.priceDisplay} 4-Week Site, then you start on Stripe.`
      : 'No sales pitch. We talk through what you have, what a site from R35,000 gets you, and whether the shape fits.'
  const hours = isUs
    ? 'WhatsApp the whole time. Overlap 8am to 12pm ET.'
    : market
      ? `WhatsApp the whole time. ${market.overlapLabel}`
      : 'All times in SAST (UTC+2). Monday to Friday, 09:00 to 17:00.'

  return (
    <main className="sc-stage sc-paper">
      <Wordmark href={homeHref} />
      <div className="sc-chrome">
        <MarketLinks current={market ? (isUs ? 'us' : undefined) : 'za'} />
      </div>

      <section className="sc-paper-page">
        <div className="sc-paper-page__inner">
          <header className="sc-paper-page__head">
            <p className="sc-tiny">{eyebrow}</p>
            <h1 className="sc-h1">{CTA_TEXT}</h1>
            <p className="sc-dek">{dek}</p>
            <div className="sc-photo sc-paper-page__photo">
              <Image
                src={STAGE_STILLS.rebuildDesk.src}
                alt={STAGE_STILLS.rebuildDesk.alt}
                fill
                sizes="(max-width: 700px) 90vw, 22rem"
                priority
              />
            </div>
          </header>

          <BookingWidget />

          <p className="sc-tiny" style={{ textAlign: 'center' }}>
            {hours}
          </p>

          <ul className="sc-paper-page__foot sc-tiny">
            <li>
              <Link href={homeHref} prefetch={false} className="sc-link">
                Back to the site
              </Link>
            </li>
            <li>
              <a href={waHref} className="sc-link" rel="noopener noreferrer">
                WhatsApp
              </a>
            </li>
            <li>
              <a href={`mailto:${SITE.email}`} className="sc-link">
                {SITE.email}
              </a>
            </li>
            <li>
              <Link href="/privacy-policy" prefetch={false} className="sc-link">
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/terms-of-service" prefetch={false} className="sc-link">
                Terms
              </Link>
            </li>
          </ul>
        </div>
      </section>
    </main>
  )
}
