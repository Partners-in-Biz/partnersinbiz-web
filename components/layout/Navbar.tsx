'use client'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { NAV } from '@/lib/seo/site'

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

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href))

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-[var(--color-pib-bg)]/85 backdrop-blur-xl border-b border-[var(--color-pib-line)]'
            : 'bg-transparent'
        }`}
      >
        <nav
          aria-label="Primary"
          className="container-pib flex items-center justify-between h-16 md:h-20"
        >
          <Link href="/" prefetch={false} aria-label="Partners in Biz home" className="flex items-center gap-2.5 group">
            <Image src="/pib-logo-64.png" alt="Partners in Biz" width={32} height={32} className="rounded-lg object-contain" />
            <span className="font-display text-xl tracking-tight hidden sm:inline">
              Partners <span className="text-[var(--color-pib-text-muted)]">in</span> Biz
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                prefetch={false}
                className={`px-4 py-2 rounded-full text-sm transition-colors ${
                  isActive(href)
                    ? 'text-[var(--color-pib-text)] bg-white/[0.06]'
                    : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              prefetch={false}
              className="hidden lg:inline-flex text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] px-3 py-2 transition-colors"
            >
              Client login
            </Link>
            <Link href="/start-a-project" prefetch={false} className="btn-pib-primary text-sm hidden sm:inline-flex">
              Start a project
              <span className="material-symbols-outlined text-base">arrow_outward</span>
            </Link>
            <button
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              className="md:hidden flex flex-col justify-center items-center w-10 h-10 gap-[5px] rounded-full hover:bg-white/[0.06] transition-colors"
            >
              <span className={`block w-5 h-px bg-current transition-all duration-300 origin-center ${open ? 'rotate-45 translate-y-[3px]' : ''}`} />
              <span className={`block w-5 h-px bg-current transition-all duration-300 origin-center ${open ? '-rotate-45 -translate-y-[3px]' : ''}`} />
            </button>
          </div>
        </nav>
      </header>

      {/* Mobile sidebar */}
      <div
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-black/70 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />
      <aside
        className={`fixed top-0 right-0 h-full w-[88%] max-w-sm z-50 bg-[var(--color-pib-bg)] border-l border-[var(--color-pib-line)] flex flex-col pt-24 pb-12 px-8 transition-transform duration-300 ease-out md:hidden ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <nav className="flex flex-col gap-1 flex-1">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              prefetch={false}
              onClick={() => setOpen(false)}
              className={`font-display text-3xl py-4 border-b border-[var(--color-pib-line)] transition-colors ${
                isActive(href) ? 'text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
              }`}
            >
              {label}
            </Link>
          ))}
          <Link
            href="/login"
            prefetch={false}
            onClick={() => setOpen(false)}
            className="font-display text-3xl py-4 border-b border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
          >
            Client login
          </Link>
        </nav>

        <div className="space-y-4">
          <Link href="/start-a-project" prefetch={false} onClick={() => setOpen(false)} className="btn-pib-primary w-full justify-center">
            Start a project
            <span className="material-symbols-outlined text-base">arrow_outward</span>
          </Link>
          <p className="font-mono text-xs text-[var(--color-pib-text-faint)] tracking-wide">
            © {new Date().getFullYear()} Partners in Biz · Pretoria
          </p>
        </div>
      </aside>
    </>
  )
}
