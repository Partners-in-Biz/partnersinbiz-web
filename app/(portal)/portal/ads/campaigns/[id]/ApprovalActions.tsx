'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { scopedApiPath } from '@/lib/portal/scoped-routing'

interface Props {
  campaignId: string
  orgId?: string
}

export function ApprovalActions({ campaignId, orgId }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const approveUrl = scopedApiPath(`/api/v1/portal/ads/campaigns/${campaignId}/approve`, { orgId })
  const rejectUrl = scopedApiPath(`/api/v1/portal/ads/campaigns/${campaignId}/reject`, { orgId })

  async function approve() {
    setBusy('approve')
    setError(null)
    try {
      const res = await fetch(approveUrl, {
        method: 'POST',
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function submitReject() {
    if (reason.trim().length < 10) {
      setError('Reason must be at least 10 characters')
      return
    }
    if (reason.length > 500) {
      setError('Reason must be 500 characters or fewer')
      return
    }
    setBusy('reject')
    setError(null)
    try {
      const res = await fetch(rejectUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (showReject) {
    return (
      <div className="space-y-2">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What needs to change? (10-500 chars)"
          rows={3}
          maxLength={500}
          className="w-full rounded border border-[var(--color-pib-line)] bg-white/[0.02] px-3 py-2 text-sm text-[var(--color-pib-text)] focus:border-amber-500/60 focus:outline-none"
        />
        <div className="flex items-center justify-between text-xs text-[var(--color-pib-text-muted)]">
          <span>{reason.length}/500</span>
          {error && <span className="text-red-300">{error}</span>}
        </div>
        <div className="flex gap-2">
          <button
            className="btn-pib-accent text-sm"
            onClick={submitReject}
            disabled={busy !== null || reason.trim().length < 10}
          >
            {busy === 'reject' ? 'Sending…' : 'Send rejection'}
          </button>
          <button
            className="btn-pib-ghost text-sm"
            onClick={() => { setShowReject(false); setReason(''); setError(null) }}
            disabled={busy !== null}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button
          className="btn-pib-accent text-sm"
          onClick={approve}
          disabled={busy !== null}
        >
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          className="btn-pib-ghost text-sm"
          onClick={() => setShowReject(true)}
          disabled={busy !== null}
        >
          Request changes
        </button>
      </div>
    </div>
  )
}
