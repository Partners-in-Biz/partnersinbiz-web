'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SITE, SERVICES, STUDIO_NAV, CTA_LABEL } from '@/lib/seo/site'
import { marketFromPathname } from '@/lib/seo/market-offers'
import { bookACallHref } from '@/lib/marketing/stage-routes'
import { MarketLinks } from '@/components/marketing/stage/StageChrome'

const SOCIAL_LINKS = [
  { label: 'LinkedIn', href: SITE.social.linkedin },
  { label: 'GitHub', href: SITE.social.github },
  { label: 'Facebook', href: SITE.social.facebook },
].filter((item) => Boolean(item.href))

/**
 * Stage-styled footer for the paper pages. One closing sentence with the CTA,
 * then the services, the studio, ways to reach us, and the legal row.
 */
export default function Footer() {
  const pathname = usePathname()
  const market = marketFromPathname(pathname)
  const bookHref = bookACallHref(market?.id)
  const waHref = `https://wa.me/${SITE.whatsapp.replace(/\D/g, '')}`

  return (
    <footer className="sc-footer" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only">Footer</h2>

      <div className="sc-footer__inner">
        <p className="sc-dek sc-footer__close">
          {market
            ? 'One price. One promise. Live in 28 days. '
            : 'Twenty minutes is enough to know if this is the right shape for you. '}
          <Link href={bookHref} prefetch={false} className="sc-cta">
            {CTA_LABEL}
          </Link>
          .
        </p>

        <div className="sc-footer__cols">
          <div>
            <p className="sc-tiny sc-footer__label">Services</p>
            <ul className="sc-footer__list">
              <li>
                <Link href="/services" prefetch={false} className="sc-link">
                  Everything we do
                </Link>
              </li>
              {SERVICES.map((s) => (
                <li key={s.slug}>
                  <Link href={`/services/${s.slug}`} prefetch={false} className="sc-link">
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="sc-tiny sc-footer__label">Studio</p>
            <ul className="sc-footer__list">
              <li>
                <Link href="/work" prefetch={false} className="sc-link">
                  Work
                </Link>
              </li>
              <li>
                <Link href="/pricing" prefetch={false} className="sc-link">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/about" prefetch={false} className="sc-link">
                  About
                </Link>
              </li>
              {STUDIO_NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} prefetch={false} className="sc-link">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="sc-tiny sc-footer__label">Reach us</p>
            <ul className="sc-footer__list">
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
              {SOCIAL_LINKS.map((item) => (
                <li key={item.href}>
                  <a href={item.href} target="_blank" rel="noopener noreferrer" className="sc-link">
                    {item.label}
                  </a>
                </li>
              ))}
              <li>
                <Link href="/login" prefetch={false} className="sc-link">
                  Client login
                </Link>
              </li>
            </ul>
            <address className="sc-body sc-footer__address">
              {SITE.address.addressLocality}, {SITE.address.addressRegion}, South Africa.
            </address>
          </div>
        </div>

        <div className="sc-footer__legal sc-tiny">
          <p>{new Date().getFullYear()} Partners in Biz</p>
          <ul className="sc-footer__legal-links">
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
            <li>
              <a href="/llms.txt" className="sc-link">
                llms.txt
              </a>
            </li>
            <li>
              <a href="/sitemap.xml" className="sc-link">
                Sitemap
              </a>
            </li>
          </ul>
          <MarketLinks current={market ? (market.id === 'us' ? 'us' : undefined) : 'za'} variant="inline" />
        </div>
      </div>
    </footer>
  )
}
