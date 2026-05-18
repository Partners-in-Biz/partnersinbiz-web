'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Sequence, SequenceStatus } from '@/lib/sequences/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SequenceStatus }) {
  const map: Record<SequenceStatus, { label: string; className: string }> = {
    draft: {
      label: 'Draft',
      className: 'text-[var(--color-pib-text-muted)] bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)]',
    },
    active: {
      label: 'Active',
      className: 'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20',
    },
    paused: {
      label: 'Paused',
      className: 'text-amber-400 bg-amber-400/10 border border-amber-400/20',
    },
  }
  const { label, className } = map[status] ?? map.draft
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${className}`}>
      {label}
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SequencesPage() {
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    fetch('/api/v1/crm/sequences')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((body) => {
        const list: Sequence[] = body.data?.sequences ?? body.data ?? []
        setSequences(Array.isArray(list) ? list : [])
      })
      .catch(() => setFetchError('Failed to load sequences. Please try again.'))
      .finally(() => setLoading(false))
  }, [])

  // ── Toggle status ──────────────────────────────────────────────────────────

  async function handleToggle(seq: Sequence) {
    if (togglingId) return
    const newStatus: SequenceStatus = seq.status === 'active' ? 'paused' : 'active'

    // Optimistic update
    setSequences((prev) =>
      prev.map((s) => (s.id === seq.id ? { ...s, status: newStatus } : s))
    )
    setTogglingId(seq.id)

    try {
      const res = await fetch(`/api/v1/crm/sequences/${seq.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
    } catch {
      // Rollback on error
      setSequences((prev) =>
        prev.map((s) => (s.id === seq.id ? { ...s, status: seq.status } : s))
      )
    } finally {
      setTogglingId(null)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function handleDelete(seq: Sequence) {
    if (!window.confirm('Delete this sequence? This cannot be undone.')) return
    setDeletingId(seq.id)
    try {
      const res = await fetch(`/api/v1/crm/sequences/${seq.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      setSequences((prev) => prev.filter((s) => s.id !== seq.id))
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeletingId(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-lg font-semibold mb-1">Sequences</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Multi-step email and SMS drip campaigns sent on a schedule.
          </p>
        </div>
        <Link
          href="/portal/settings/sequences/new"
          className="btn-pib-accent flex items-center gap-1.5 text-sm shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          New sequence
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
      ) : fetchError ? (
        <div className="px-4 py-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm text-[var(--color-pib-text-muted)]">
          {fetchError}
        </div>
      ) : sequences.length === 0 ? (
        <div className="bento-card !p-8 text-center">
          <span className="material-symbols-outlined text-4xl mb-2 block text-[var(--color-pib-text-muted)]">
            bolt
          </span>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            No sequences yet. Create your first drip campaign.
          </p>
          <Link
            href="/portal/settings/sequences/new"
            className="btn-pib-accent flex items-center gap-1.5 text-sm mx-auto mt-4 w-fit"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            New sequence
          </Link>
        </div>
      ) : (
        <div className="bento-card !p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-pib-line)]">
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">
                  Name
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">
                  Steps
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">
                  Toggle
                </th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">
                  Edit / Delete
                </th>
              </tr>
            </thead>
            <tbody>
              {sequences.map((seq, i) => {
                const isToggling = togglingId === seq.id
                const isDeleting = deletingId === seq.id

                return (
                  <tr
                    key={seq.id}
                    className={[
                      'transition-colors hover:bg-white/[0.02]',
                      i < sequences.length - 1 ? 'border-b border-[var(--color-pib-line)]' : '',
                      isDeleting ? 'opacity-50 pointer-events-none' : '',
                    ].join(' ')}
                  >
                    {/* Name */}
                    <td className="px-4 py-3 font-medium max-w-[220px]">
                      <span className="block truncate">{seq.name}</span>
                      {seq.description && (
                        <span className="block text-xs text-[var(--color-pib-text-muted)] truncate mt-0.5">
                          {seq.description}
                        </span>
                      )}
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3">
                      <StatusBadge status={seq.status} />
                    </td>

                    {/* Step count */}
                    <td className="px-4 py-3 text-[var(--color-pib-text-muted)] text-xs whitespace-nowrap">
                      {seq.steps.length} step{seq.steps.length !== 1 ? 's' : ''}
                    </td>

                    {/* Status toggle */}
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleToggle(seq)}
                        disabled={isToggling || seq.status === 'draft'}
                        title={
                          seq.status === 'draft'
                            ? 'Activate the sequence to toggle'
                            : seq.status === 'active'
                            ? 'Pause sequence'
                            : 'Activate sequence'
                        }
                        className={[
                          'cursor-pointer text-xs px-2.5 py-1 rounded-full border transition-colors',
                          seq.status === 'active'
                            ? 'border-amber-400/30 text-amber-400 hover:bg-amber-400/10'
                            : seq.status === 'paused'
                            ? 'border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/10'
                            : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] opacity-50 cursor-not-allowed',
                          isToggling ? 'opacity-50' : '',
                        ].join(' ')}
                      >
                        {isToggling
                          ? '…'
                          : seq.status === 'active'
                          ? 'Pause'
                          : seq.status === 'paused'
                          ? 'Activate'
                          : 'Draft'}
                      </button>
                    </td>

                    {/* Edit / Delete */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/portal/settings/sequences/${seq.id}/edit`}
                          title="Edit sequence"
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06] transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px]">edit</span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDelete(seq)}
                          disabled={isDeleting}
                          title="Delete sequence"
                          className="cursor-pointer w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-red-400 hover:bg-red-400/[0.08] transition-colors"
                        >
                          {isDeleting ? (
                            <span className="material-symbols-outlined text-[16px] animate-spin">
                              progress_activity
                            </span>
                          ) : (
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
