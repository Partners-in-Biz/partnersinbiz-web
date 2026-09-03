'use client'

import Link from 'next/link'

export function PortalFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-[var(--sc-line)] px-[var(--sc-pad)] py-[calc(var(--sc-u)*4)]">
      <p className="sc-tiny text-[var(--sc-ink-soft)] m-0 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span>© {year} Partners in Biz · Pretoria</span>
        <Link href="/privacy-policy" className="hover:text-[var(--sc-ink)] transition-colors">
          Privacy
        </Link>
        <Link href="/terms-of-service" className="hover:text-[var(--sc-ink)] transition-colors">
          Terms
        </Link>
      </p>
    </footer>
  )
}
