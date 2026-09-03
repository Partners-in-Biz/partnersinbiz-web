'use client'

import { useEffect, useState } from 'react'

interface DeadLetterEnrollment {
  id: string
  contactId: string
  status: string
  deadLetter?: { reason?: string; attempts?: number }
}

export default function SequenceDeadLetterControl({
  sequenceId,
  endpoint,
}: {
  sequenceId: string
  endpoint: (path: string) => string
}) {
  const [items, setItems] = useState<DeadLetterEnrollment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(endpoint(`/api/v1/crm/sequences/${sequenceId}/enrollments`))
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body?.error ?? 'Failed to load failed enrollments')
        return body?.data?.enrollments ?? []
      })
      .then((enrollments: DeadLetterEnrollment[]) => {
        if (!cancelled) setItems(enrollments.filter((item) => item.status === 'dead_letter'))
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Failed to load failed enrollments')
      })
    return () => { cancelled = true }
  }, [endpoint, sequenceId])

  async function replay(item: DeadLetterEnrollment) {
    setRetrying(item.id)
    setError(null)
    try {
      const key = globalThis.crypto?.randomUUID?.() ?? `retry-${item.id}-${Date.now()}`
      const response = await fetch(endpoint(`/api/v1/crm/sequences/${sequenceId}/enrollments/${item.id}/replay`), {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error ?? 'Retry failed')
      setItems((current) => current.filter((entry) => entry.id !== item.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Retry failed')
    } finally {
      setRetrying(null)
    }
  }

  if (items.length === 0 && !error) return null
  return (
    <section className="mt-3 rounded-lg border border-amber-400/20 bg-[var(--st-warning)]/[0.05] p-3" aria-label="Journey delivery failures">
      <div className="mb-2">
        <p className="text-xs font-medium">Delivery failures</p>
        <p className="text-[11px] text-[var(--color-pib-text-muted)]">Review and safely requeue the current step.</p>
      </div>
      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 rounded border border-[var(--color-card-border)] px-2 py-1.5 text-xs">
            <div className="min-w-0">
              <p className="truncate">{item.contactId}</p>
              <p className="truncate text-[11px] text-[var(--color-pib-text-muted)]">{item.deadLetter?.reason ?? 'Delivery failed'} · {item.deadLetter?.attempts ?? 0} attempts</p>
            </div>
            <button type="button" disabled={retrying === item.id} onClick={() => replay(item)} aria-label={`Retry ${item.contactId}`} className="rounded border border-[var(--color-card-border)] px-2 py-1 text-[11px] disabled:opacity-50">
              {retrying === item.id ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
