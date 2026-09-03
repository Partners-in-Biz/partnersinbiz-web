'use client'

import Link from 'next/link'

export function PortalFooter() {
  return (
    <footer className="px-4 md:px-8 py-6 border-t border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] text-xs flex flex-wrap items-center justify-between gap-3">
      <span>© {new Date().getFullYear()} Partners in Biz · Pretoria</span>
      <div className="flex items-center gap-4">
        <Link href="/privacy-policy" className="hover:text-[var(--color-pib-text)] transition-colors">Privacy</Link>
        <Link href="/terms-of-service" className="hover:text-[var(--color-pib-text)] transition-colors">Terms</Link>
      </div>
    </footer>
  )
}
