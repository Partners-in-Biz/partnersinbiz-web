'use client'
export const dynamic = 'force-dynamic'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SequenceForm } from '@/components/crm/SequenceForm'
import type { Sequence } from '@/lib/sequences/types'

export default function EditSequencePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()

  const [sequence, setSequence] = useState<Sequence | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setFetchError(null)
    fetch('/api/v1/crm/sequences')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((body) => {
        const list: Sequence[] = body.data?.sequences ?? body.data ?? []
        const found = Array.isArray(list) ? list.find((s) => s.id === id) ?? null : null
        if (!found) throw new Error('Sequence not found.')
        setSequence(found)
      })
      .catch((err: unknown) =>
        setFetchError(err instanceof Error ? err.message : 'Failed to load sequence.')
      )
      .finally(() => setLoading(false))
  }, [id])

  function handleSave(_seq: Sequence) {
    router.push('/portal/settings/sequences')
  }

  function handleCancel() {
    router.push('/portal/settings/sequences')
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <button
          type="button"
          onClick={handleCancel}
          className="cursor-pointer flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] mb-4 transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">arrow_back</span>
          Sequences
        </button>
        <h1 className="text-lg font-semibold">Edit Sequence</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">
          Update steps, timing, and status.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
      ) : fetchError ? (
        <div className="px-4 py-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm text-[var(--color-pib-text-muted)]">
          {fetchError}
        </div>
      ) : sequence ? (
        <SequenceForm initial={sequence} onSave={handleSave} onCancel={handleCancel} />
      ) : null}
    </div>
  )
}
