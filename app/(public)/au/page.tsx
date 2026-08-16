import type { Metadata } from 'next'
import { SITE } from '@/lib/seo/site'
import { MARKET_OFFERS } from '@/lib/seo/market-offers'
import { MarketOfferPage } from '@/components/marketing/MarketOfferPage'

const market = MARKET_OFFERS.au

export const metadata: Metadata = {
  title: `The 4-Week Site — ${market.priceDisplay}`,
  description: `A production Next.js site that gets you clients. ${market.priceDisplay}. Yours in 28 days. You own the GitHub, Vercel, and domain. Half on Stripe to start, half on launch.`,
  alternates: { canonical: market.path },
  openGraph: {
    title: `The 4-Week Site — ${market.priceDisplay} | Partners in Biz`,
    description: `Production Next.js in four weeks. You own the repo. Half on Stripe to start, half on launch.`,
    url: `${SITE.url}${market.path}`,
    type: 'website',
    images: ['/og/default.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: `The 4-Week Site — ${market.priceDisplay}`,
    description: 'A site that gets you clients. Yours in 28 days.',
  },
}

export default function AuOfferRoute() {
  return <MarketOfferPage market={market} />
}
