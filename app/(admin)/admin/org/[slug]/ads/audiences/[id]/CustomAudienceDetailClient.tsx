'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdCustomAudienceStatus } from '@/lib/ads/types'

interface Props {
  orgId: string
  orgSlug: string
  caId: string
  currentStatus: AdCustomAudienceStatus
}

export function CustomAudienceDetailClient({ orgId, orgSlug, caId }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<'refresh' | 'delete' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function refreshSize() {
    setBusy('refresh')
    setActionError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/ads/custom-audiences/${caId}/refresh-size`, {
        method: 'POST',
        headers: { 'X-Org-Id': orgId },
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      setMessage('Custom audience size refresh requested.')
      router.refresh()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function requestDelete() {
    setActionError(null)
    setMessage(null)
    setConfirmDelete(true)
  }

  async function doDelete() {
    setBusy('delete')
    setActionError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/ads/custom-audiences/${caId}`, {
        method: 'DELETE',
        headers: { 'X-Org-Id': orgId },
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.push(`/admin/org/${orgSlug}/ads/audiences`)
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      {confirmDelete && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={`Delete custom audience ${caId} for ${orgSlug}?`}
          className="rounded-lg border border-red-400/30 bg-red-400/10 p-4"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-semibold text-red-100">Delete custom audience?</h2>
              <p className="mt-1 text-sm text-red-100/80">
                This removes the audience from PiB and requests best-effort removal from connected ad platforms. Campaign history stays in PiB.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md border border-red-100/30 px-3 py-2 text-xs font-medium text-red-50 hover:bg-red-50/10 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setConfirmDelete(false)}
                disabled={busy === 'delete'}
              >
                Keep custom audience
              </button>
              <button
                type="button"
                className="rounded-md bg-red-300 px-3 py-2 text-xs font-medium text-red-950 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={doDelete}
                disabled={busy === 'delete'}
              >
                {busy === 'delete' ? 'Deleting...' : `Confirm delete custom audience ${caId} for ${orgSlug}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {(message || actionError) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            actionError
              ? 'border-red-400/30 bg-red-400/10 text-red-200'
              : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
          }`}
        >
          {actionError ?? message}
        </div>
      )}

      <div className="flex gap-2">
        <button
          className="btn-pib-ghost text-sm"
          onClick={refreshSize}
          disabled={busy !== null}
          aria-label={`Refresh custom audience size for ${caId}`}
        >
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh size'}
        </button>
        <button
          className="btn-pib-ghost text-sm text-red-300"
          onClick={requestDelete}
          disabled={busy !== null}
          aria-label={`Delete custom audience ${caId} for ${orgSlug}`}
        >
          {busy === 'delete' ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  )
}
