'use client'

import Link from 'next/link'
import { useEffect, type ReactNode } from 'react'

export function PreviewFrame({
  backHref,
  versionLabel,
  shareUrl,
  children,
}: {
  backHref: string
  versionLabel: string
  shareUrl?: string
  children: ReactNode
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        window.location.href = backHref
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [backHref])

  return (
    <>
      <div
        data-testid="document-preview-toolbar"
        className="sticky top-0 z-20 -mx-4 mb-4 border-b border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]/95 px-4 py-3 backdrop-blur md:-mx-8 md:mb-6 md:px-8"
      >
        <div className="mx-auto flex max-w-[1400px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href={backHref}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-black/70 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white backdrop-blur hover:bg-black/85 sm:justify-start"
          >
            <span aria-hidden>←</span> Back to editor
          </Link>
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
            <span className="min-h-10 max-w-full rounded-full bg-black/70 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white backdrop-blur">
              {versionLabel}
            </span>
            {shareUrl && (
              <Link
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 max-w-full items-center justify-center rounded-full bg-[var(--color-pib-accent)] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-black hover:bg-[var(--color-pib-accent-hover)]"
              >
                Open public share →
              </Link>
            )}
          </div>
        </div>
      </div>
      {children}
    </>
  )
}
