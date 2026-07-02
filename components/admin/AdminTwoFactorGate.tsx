'use client'

import { useEffect, useState } from 'react'
import { TwoFactorGate } from '@/components/settings/TwoFactorGate'

function unwrap(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return ((body as { data?: Record<string, unknown> }).data) ?? {}
  }
  return (body as Record<string, unknown>) ?? {}
}

export function AdminTwoFactorGate() {
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
        if (data.enabled !== true) {
          setReady(true)
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
  }, [])

  if (!ready) return null

  return <TwoFactorGate />
}

export default AdminTwoFactorGate
