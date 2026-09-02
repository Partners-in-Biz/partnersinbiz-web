import Link from 'next/link'
import type { StageMarket } from '@/lib/marketing/stage-content'

const MARKETS: ReadonlyArray<{ id: StageMarket; label: string; href: '/' | '/us' }> = [
  { id: 'za', label: 'ZA', href: '/' },
  { id: 'us', label: 'US', href: '/us' },
]

/** Tiny ZA / US text links. On the stage they sit on the divider line. Not a globe, not a bar. */
export function MarketLinks({
  current,
  variant = 'chrome',
}: {
  current?: StageMarket
  variant?: 'chrome' | 'inline'
}) {
  const listClass = variant === 'chrome' ? 'sc-chrome__markets sc-tiny' : 'sc-inline-markets'
  return (
    <nav aria-label="Region">
      <ul className={listClass}>
        {MARKETS.map((m) => (
          <li key={m.id}>
            <Link
              href={m.href}
              prefetch={false}
              className="sc-link"
              aria-current={current === m.id ? 'page' : undefined}
            >
              {m.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function Wordmark({ href }: { href: '/' | '/us' }) {
  return (
    <Link href={href} prefetch={false} className="sc-wordmark sc-tiny">
      Partners in Biz
    </Link>
  )
}
