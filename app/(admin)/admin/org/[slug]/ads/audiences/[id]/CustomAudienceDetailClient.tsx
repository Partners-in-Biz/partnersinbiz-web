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
          className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error-container)] p-4"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-medium text-[var(--color-pib-text)]">Delete custom audience?</h2>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                This removes the audience from PiB and requests best-effort removal from connected ad platforms. Campaign history stays in PiB.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-pib-secondary text-xs"
                onClick={() => setConfirmDelete(false)}
                disabled={busy === 'delete'}
              >
                Keep custom audience
              </button>
              <button
                type="button"
                className="btn-pib-danger text-xs"
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
          className={`rounded-md border px-4 py-3 text-sm ${ actionError ? 'border-[var(--color-error)]/30 bg-[var(--color-error-container)] text-[var(--color-error)]' : 'border-[var(--color-pib-success)]/30 bg-[var(--color-pib-success)]/10 text-[var(--color-pib-success)]' }`}
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
          className="btn-pib-ghost text-sm text-[var(--color-error)]"
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
