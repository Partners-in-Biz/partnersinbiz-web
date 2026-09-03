// components/settings/ProfileCompleteBanner.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { Icon } from '@/components/studio'

export function ProfileCompleteBanner() {
  const [show, setShow] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  useEffect(() => {
    fetch('/api/v1/portal/settings/profile')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.profile) return
        const { firstName, profileBannerDismissed } = d.profile
        if (!firstName && !profileBannerDismissed) setShow(true)
      })
      .catch(() => {})
  }, [])

  async function handleDismiss() {
    setDismissing(true)
    await fetch('/api/v1/portal/settings/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: '', lastName: '', profileBannerDismissed: true }),
    }).catch(() => {})
    setShow(false)
    setDismissing(false)
  }

  if (!show) return null

  return (
    <div className="mb-6 flex items-start gap-4 bg-[var(--color-pib-accent-soft)] border border-[var(--color-pib-accent)]/20 rounded-md px-5 py-4">
      <Icon name="person" className="text-[20px] text-[var(--color-pib-accent)] mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Complete your workspace profile</p>
        <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
          Add your name and title so your team knows who you are.
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Link href="/portal/settings/profile" className="text-sm text-[var(--color-pib-accent)] hover:underline whitespace-nowrap">
          Set up profile →
        </Link>
        <button
          onClick={handleDismiss}
          disabled={dismissing}
          className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
          aria-label="Dismiss"
        >
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>
    </div>
  )
}
