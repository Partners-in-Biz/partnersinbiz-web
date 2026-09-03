'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { Icon } from '@/components/studio'

const STORAGE_KEY = 'pib-banner-properties-launch-2026-05'

export function PropertiesLaunchBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(STORAGE_KEY) !== 'dismissed') {
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  const dismiss = () => {
    window.localStorage.setItem(STORAGE_KEY, 'dismissed')
    setVisible(false)
  }

  return (
    <div className="relative overflow-hidden rounded-md border border-[var(--color-pib-accent)]/30 bg-[color-mix(in_srgb,var(--color-pib-accent)_8%,transparent)] p-4 md:p-5">
      <div className="flex items-start gap-3 md:gap-4">
        <Icon name="rocket_launch" className="text-[var(--color-pib-accent)] mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="eyebrow !text-[10px] text-[var(--color-pib-accent)]">New · Properties</p>
          <h3 className="mt-1 text-lg md:text-xl text-[var(--color-pib-text)]">
            Manage every client site as a portfolio.
          </h3>
          <p className="mt-1 text-sm text-[var(--color-pib-text-muted)] max-w-2xl">
            Kill switches, deploy hooks, revenue + analytics, and a single dashboard
            for every site you ship. Properties is live  -  connect your first site in under a minute.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link href="/portal/properties" className="btn-pib-accent text-sm">
              Open Properties
              <Icon name="arrow_outward" className="text-base" />
            </Link>
            <Link
              href="/insights/manage-multiple-client-websites"
              className="btn-pib-secondary text-sm"
            >
              Read the playbook
            </Link>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 -mr-1 -mt-1 p-1 rounded-md text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/5 transition-colors"
        >
          <Icon name="close" className="text-base" />
        </button>
      </div>
    </div>
  )
}
