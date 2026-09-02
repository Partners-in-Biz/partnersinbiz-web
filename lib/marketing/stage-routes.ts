import { marketFromId } from '@/lib/seo/market-offers'

/**
 * Routes rendered on the paper split stage. These pages carry their own chrome
 * (the divider, tiny ZA / US text links, a colophon), so the shared public
 * Navbar and Footer step aside on them.
 */
export const STAGE_ROUTES = ['/', '/us', '/book-a-call'] as const

export function isStageRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  const clean = pathname.split('?')[0].replace(/\/+$/, '') || '/'
  return (STAGE_ROUTES as readonly string[]).includes(clean)
}

/** The one scheduler. A known market id is carried across as a query hint. */
export function bookACallHref(marketId?: string | null): string {
  const market = marketFromId(marketId)
  return market ? `/book-a-call?market=${market.id}` : '/book-a-call'
}
