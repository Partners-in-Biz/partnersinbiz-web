'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdEntityStatus } from '@/lib/ads/types'

interface Props {
  orgId: string
  orgSlug: string
  campaignId: string
  status: AdEntityStatus
  reviewState?: 'awaiting' | 'approved' | 'rejected'
}

export function AdCampaignAdminActions({ orgId, orgSlug, campaignId, status, reviewState }: Props) {
  const router = useRouter()
  const launchApproved = reviewState === 'approved'
  const [busy, setBusy] = useState<'launch' | 'pause' | 'delete' | 'submit' | null>(null)
  const [confirmAction, setConfirmAction] = useState<'delete' | 'submit' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function call(action: 'launch' | 'pause') {
    setBusy(action)
    setActionError(null)
    try {
      const res = await fetch(`/api/v1/ads/campaigns/${campaignId}/${action}`, {
        method: 'POST',
        headers: { 'X-Org-Id': orgId },
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Campaign action failed')
    } finally {
      setBusy(null)
    }
  }

  function requestSubmitForReview() {
    setActionError(null)
    setConfirmAction('submit')
  }

  async function confirmSubmitForReview() {
    setBusy('submit')
    setActionError(null)
    try {
      const res = await fetch(`/api/v1/ads/campaigns/${campaignId}/submit-for-review`, {
        method: 'POST',
        headers: { 'X-Org-Id': orgId },
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      setConfirmAction(null)
      router.refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Campaign review submission failed')
    } finally {
      setBusy(null)
    }
  }

  function requestDelete() {
    setActionError(null)
    setConfirmAction('delete')
  }

  async function confirmDelete() {
    setBusy('delete')
    setActionError(null)
    try {
      const res = await fetch(`/api/v1/ads/campaigns/${campaignId}`, {
        method: 'DELETE',
        headers: { 'X-Org-Id': orgId },
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      setConfirmAction(null)
      router.push(`/admin/org/${orgSlug}/ads/campaigns`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Campaign delete failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-3">
      {actionError && (
        <div role="alert" className="max-w-sm rounded border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {actionError}
        </div>
      )}

      {confirmAction && (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="campaign-action-confirm-title"
          aria-describedby="campaign-action-confirm-description"
          className="max-w-md rounded-lg border border-[#F5A623]/30 bg-[#F5A623]/10 p-4 text-sm shadow-sm"
        >
          <h2 id="campaign-action-confirm-title" className="font-semibold text-white">
            {confirmAction === 'submit'
              ? `Submit campaign ${campaignId} for client review?`
              : `Delete campaign ${campaignId}?`}
          </h2>
          <p id="campaign-action-confirm-description" className="mt-1 text-xs text-white/65">
            {confirmAction === 'submit'
              ? 'This sends the campaign to the client portal and notifies the client for approval.'
              : 'This permanently removes the campaign in PiB and best-effort archives it in Meta.'}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="rounded border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:text-white disabled:opacity-40"
              onClick={() => setConfirmAction(null)}
              disabled={busy !== null}
            >
              Cancel
            </button>
            <button
              type="button"
              className={
                confirmAction === 'delete'
                  ? 'rounded border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-40'
                  : 'rounded border border-[#F5A623]/40 bg-[#F5A623]/10 px-3 py-1.5 text-xs font-medium text-[#F5A623] hover:bg-[#F5A623]/20 disabled:opacity-40'
              }
              onClick={confirmAction === 'submit' ? confirmSubmitForReview : confirmDelete}
              disabled={busy !== null}
              aria-label={
                confirmAction === 'submit'
                  ? `Confirm submit campaign ${campaignId} for client review`
                  : `Confirm delete campaign ${campaignId}`
              }
            >
              {busy === 'submit' ? 'Sending...' : busy === 'delete' ? 'Deleting...' : confirmAction === 'submit' ? 'Submit for review' : 'Delete campaign'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {status === 'DRAFT' && reviewState !== 'awaiting' && reviewState !== 'approved' && (
          <button
            className="btn-pib-ghost text-sm"
            onClick={requestSubmitForReview}
            disabled={busy !== null}
            aria-label={`Submit campaign ${campaignId} for client review`}
          >
            {busy === 'submit' ? 'Sending...' : 'Submit for client review'}
          </button>
        )}
        {status !== 'ACTIVE' ? (
          <button
            className="btn-pib-accent text-sm disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => call('launch')}
            disabled={busy !== null || !launchApproved}
            aria-label={`Launch campaign ${campaignId}`}
            title={launchApproved ? 'Launch approved campaign' : 'Launch locked until client approval is recorded'}
          >
            {busy === 'launch' ? 'Launching...' : launchApproved ? 'Launch approved campaign' : 'Launch locked'}
          </button>
        ) : (
          <button
            className="btn-pib-ghost text-sm"
            onClick={() => call('pause')}
            disabled={busy !== null}
            aria-label={`Pause campaign ${campaignId}`}
          >
            {busy === 'pause' ? 'Pausing...' : 'Pause'}
          </button>
        )}
        {status !== 'ACTIVE' && !launchApproved && (
          <p className="basis-full text-right text-xs text-amber-200/75">
            Launch and paid-spend controls stay locked until client approval is recorded in the portal.
          </p>
        )}
        <button
          className="btn-pib-ghost text-sm text-red-300"
          onClick={requestDelete}
          disabled={busy !== null}
          aria-label={`Delete campaign ${campaignId}`}
        >
          {busy === 'delete' ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  )
}
