'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  orgId: string
  level: 'campaign' | 'adset' | 'ad'
  pibEntityId: string
  size?: 'sm' | 'md'
}

export function RefreshButton({ orgId, level, pibEntityId, size = 'md' }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function trigger() {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const res = await fetch('/api/v1/ads/insights/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
        body: JSON.stringify({ level, pibEntityId }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Refresh failed')
      setMessage('Insights refresh queued.')
      // Wait a beat for queue to drain, then refresh
      setTimeout(() => router.refresh(), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="inline-flex flex-col items-start gap-2">
      <button
        type="button"
        className={`btn-pib-ghost ${size === 'sm' ? 'text-xs px-2 py-1' : 'text-sm'}`}
        onClick={trigger}
        disabled={busy}
      >
        {busy ? 'Refreshing...' : 'Refresh insights'}
      </button>
      {message && (
        <span role="status" className="text-xs text-emerald-300">
          {message}
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-red-300">
          {error}
        </span>
      )}
    </div>
  )
}
