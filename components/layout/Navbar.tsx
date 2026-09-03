'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { NAV, CTA_LABEL } from '@/lib/seo/site'
import { marketFromPathname, marketNav } from '@/lib/seo/market-offers'
import { bookACallHref } from '@/lib/marketing/stage-routes'

/**
 * Stage chrome for the paper pages: a wordmark, four text links, one CTA.
 * The split stage itself renders no navbar (see PublicShell).
 */
export default function Navbar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  const isActive = (href: string) => {
    const path = href.split('?')[0]
    return pathname === path || (path !== '/' && pathname.startsWith(path))
  }
  const market = marketFromPathname(pathname)
  const bookHref = bookACallHref(market?.id)
  const homeHref = market ? market.path : '/'
  const links = market ? marketNav(market.id) : NAV

  return (
    <>
      <header className={`sc-nav${scrolled ? ' sc-nav--scrolled' : ''}`}>
        <nav aria-label="Primary" className="sc-nav__inner">
          <Link href={homeHref} prefetch={false} className="sc-nav__wordmark sc-tiny" aria-label="Partners in Biz home">
            Partners in Biz
          </Link>

          <ul className="sc-nav__links sc-tiny">
            {links.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  prefetch={false}
                  className="sc-link"
                  aria-current={isActive(href) ? 'page' : undefined}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="sc-nav__actions">
            {!market && (
              <Link href="/login" prefetch={false} className="sc-link sc-tiny sc-nav__login">
                Client login
              </Link>
            )}
            <Link href={bookHref} prefetch={false} className="sc-cta sc-nav__cta">
              {CTA_LABEL}
            </Link>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              className="sc-nav__burger"
            >
              <span className={open ? 'is-open' : ''} />
              <span className={open ? 'is-open' : ''} />
            </button>
          </div>
        </nav>
      </header>

      <div
        onClick={() => setOpen(false)}
        className={`sc-nav__scrim${open ? ' is-open' : ''}`}
        aria-hidden="true"
      />
      <aside className={`sc-nav__sheet${open ? ' is-open' : ''}`} aria-label="Menu">
        <nav className="sc-nav__sheet-links">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              prefetch={false}
              onClick={() => setOpen(false)}
              className="sc-nav__sheet-link"
              aria-current={isActive(href) ? 'page' : undefined}
            >
              {label}
            </Link>
          ))}
          {!market && (
            <Link href="/login" prefetch={false} onClick={() => setOpen(false)} className="sc-nav__sheet-link">
              Client login
            </Link>
          )}
        </nav>
        <div className="sc-nav__sheet-foot">
          <Link href={bookHref} prefetch={false} onClick={() => setOpen(false)} className="sc-cta">
            {CTA_LABEL}
          </Link>
          <p className="sc-tiny">
            {new Date().getFullYear()} Partners in Biz{market ? '' : '. Pretoria.'}
          </p>
        </div>
      </aside>
    </>
  )
}
