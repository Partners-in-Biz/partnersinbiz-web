'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function BulkApproveButton({ count }: { count: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function approveAll() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/v1/portal/ads/campaigns/bulk-approve', { method: 'POST' })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      const approved = body.data?.approved ?? []
      const failed = body.data?.failed ?? []
      if (failed.length > 0) {
        const followUp = failed
          .map((item: { id: string; error: string }) => `${item.id}: ${item.error}`)
          .join('; ')
        setNotice(
          `Approved ${approved.length} ${approved.length === 1 ? 'campaign' : 'campaigns'}. ${failed.length} ${failed.length === 1 ? 'campaign needs' : 'campaigns need'} follow-up: ${followUp}`,
        )
      } else {
        setNotice(`Approved ${approved.length} ${approved.length === 1 ? 'campaign' : 'campaigns'}.`)
      }
      setConfirming(false)
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        className="btn-pib-accent px-3 py-1.5 text-xs"
        onClick={() => {
          setConfirming(true)
          setNotice(null)
          setError(null)
        }}
        disabled={busy || count === 0}
        aria-label={`Approve all pending ${count === 1 ? 'campaign' : 'campaigns'} (${count})`}
      >
        {busy ? 'Approving...' : `Approve all (${count})`}
      </button>

      {confirming && (
        <section
          role="alertdialog"
          aria-labelledby="bulk-approve-title"
          aria-describedby="bulk-approve-description"
          className="max-w-md rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 text-left shadow-xl"
        >
          <p className="eyebrow !text-[10px] !text-amber-100/80">Bulk approval</p>
          <h3 id="bulk-approve-title" className="mt-1 font-display text-base text-amber-50">
            Approve {count} pending {count === 1 ? 'campaign' : 'campaigns'}?
          </h3>
          <p id="bulk-approve-description" className="mt-2 text-sm leading-6 text-amber-100/90">
            This marks every pending campaign as approved and ready for launch. Review owners will see the refreshed approval state after this action.
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="btn-pib-secondary text-xs"
              onClick={() => setConfirming(false)}
              disabled={busy}
              aria-label={`Cancel approve ${count} pending ${count === 1 ? 'campaign' : 'campaigns'}`}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-pib-primary text-xs"
              onClick={approveAll}
              disabled={busy}
              aria-label={`Confirm approve ${count} pending ${count === 1 ? 'campaign' : 'campaigns'}`}
            >
              {busy ? 'Approving...' : 'Approve campaigns'}
            </button>
          </div>
        </section>
      )}

      {(notice || error) && (
        <div
          role={error ? 'alert' : 'status'}
          className={`max-w-md rounded-lg border px-3 py-2 text-left text-xs leading-5 ${
            error
              ? 'border-red-400/40 bg-red-500/10 text-red-100'
              : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
          }`}
        >
          {error ?? notice}
        </div>
      )}
    </div>
  )
}
