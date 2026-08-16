import { SITE } from '@/lib/seo/site'

export type MarketId = 'us' | 'uk' | 'au'

export interface MarketOffer {
  id: MarketId
  path: `/${MarketId}`
  regionLabel: string
  currencyCode: 'USD' | 'GBP' | 'AUD'
  /** Display price with symbol, e.g. "$9,500" */
  priceDisplay: string
  /** Schema.org price amount without formatting */
  priceAmount: string
  portalFromDisplay: string
  retainerDisplay: string
  cheapAltDisplay: string
  overlapLabel: string
  overlapShort: string
  footerBadge: string
  whoFor: string
  countries: readonly string[]
}

export const MARKET_OFFERS: Record<MarketId, MarketOffer> = {
  us: {
    id: 'us',
    path: '/us',
    regionLabel: 'United States',
    currencyCode: 'USD',
    priceDisplay: '$9,500',
    priceAmount: '9500',
    portalFromDisplay: 'From $35,000',
    retainerDisplay: '$2,500/month',
    cheapAltDisplay: '$1,500 Wix',
    overlapLabel: 'Overlap 8am–12pm ET.',
    overlapShort: 'WhatsApp · 8am–12pm ET overlap',
    footerBadge: 'USD · Stripe · ET overlap',
    whoFor: 'US founder-led firms. Law, clinics, coaches, B2B services. You have demand and a dead site.',
    countries: ['US', 'CA'],
  },
  uk: {
    id: 'uk',
    path: '/uk',
    regionLabel: 'United Kingdom',
    currencyCode: 'GBP',
    priceDisplay: '£7,500',
    priceAmount: '7500',
    portalFromDisplay: 'From £28,000',
    retainerDisplay: '£2,000/month',
    cheapAltDisplay: '£1,200 Wix',
    overlapLabel: 'Overlap 8am–12pm GMT.',
    overlapShort: 'WhatsApp · 8am–12pm GMT overlap',
    footerBadge: 'GBP · Stripe · GMT overlap',
    whoFor: 'UK founder-led firms. Law, clinics, coaches, B2B services. You have demand and a dead site.',
    countries: ['GB'],
  },
  au: {
    id: 'au',
    path: '/au',
    regionLabel: 'Australia',
    currencyCode: 'AUD',
    priceDisplay: 'A$14,500',
    priceAmount: '14500',
    portalFromDisplay: 'From A$55,000',
    retainerDisplay: 'A$3,800/month',
    cheapAltDisplay: 'A$2,000 Wix',
    overlapLabel: 'Overlap 7–11am AEST (our evening).',
    overlapShort: 'WhatsApp · 7–11am AEST overlap',
    footerBadge: 'AUD · Stripe · AEST overlap',
    whoFor: 'Australian founder-led firms. Law, clinics, coaches, B2B services. You have demand and a dead site.',
    countries: ['AU'],
  },
}

/** Country ISO → market path for homepage geo redirect. CA folds into US. */
export const GEO_MARKET_BY_COUNTRY: Record<string, MarketId> = {
  US: 'us',
  CA: 'us',
  GB: 'uk',
  AU: 'au',
}

export const MARKET_PATHS = Object.values(MARKET_OFFERS).map((m) => m.path)

export function isMarketPath(pathname: string): boolean {
  return MARKET_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function marketFromPathname(pathname: string): MarketOffer | null {
  for (const offer of Object.values(MARKET_OFFERS)) {
    if (pathname === offer.path || pathname.startsWith(`${offer.path}/`)) return offer
  }
  return null
}

export function marketFromId(id: string | undefined | null): MarketOffer | null {
  if (!id) return null
  if (id === 'us' || id === 'uk' || id === 'au') return MARKET_OFFERS[id]
  return null
}

export function marketStartHref(market: MarketId): string {
  return `/start-a-project?offer=4-week-site&market=${market}`
}

export function marketBookHref(market: MarketId): string {
  return `/book-a-call?market=${market}`
}

export function marketNav(market: MarketId) {
  const offer = MARKET_OFFERS[market]
  return [
    { href: offer.path, label: 'Offer' },
    { href: '/work', label: 'Work' },
    { href: '/?home=1', label: 'Studio' },
    { href: marketBookHref(market), label: 'Book' },
  ] as const
}

export function marketOfferUrl(market: MarketId): string {
  return `${SITE.url}${MARKET_OFFERS[market].path}`
}
