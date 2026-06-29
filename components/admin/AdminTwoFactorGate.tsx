'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { TwoFactorGate } from '@/components/settings/TwoFactorGate'

function unwrap(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return ((body as { data?: Record<string, unknown> }).data) ?? {}
  }
  return (body as Record<string, unknown>) ?? {}
}

export function AdminTwoFactorGate() {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetch('/api/v1/account/2fa/status', { cache: 'no-store' })
      .then(async (res) => unwrap(await res.json().catch(() => ({}))))
      .then((data) => {
        if (cancelled) return
        if (data.disabledByPolicy === true) {
          setReady(true)
          return
        }
        if (data.enabled !== true && pathname !== '/admin/2fa') {
          router.replace(`/admin/2fa?returnTo=${encodeURIComponent(pathname || '/admin/dashboard')}`)
          return
        }
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [pathname, router])

  if (!ready && pathname !== '/admin/2fa') return null

  return <TwoFactorGate />
}

export default AdminTwoFactorGate
