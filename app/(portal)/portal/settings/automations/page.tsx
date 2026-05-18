'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { AutomationRule } from '@/lib/automations/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function triggerLabel(rule: AutomationRule): string {
  const labels: Record<string, string> = {
    'deal.created': 'Deal created',
    'deal.stage_changed': 'Deal stage changed',
    'deal.won': 'Deal won',
    'deal.lost': 'Deal lost',
    'contact.created': 'Contact created',
    'contact.lifecycle_changed': 'Contact lifecycle changed',
  }
  let label = labels[rule.trigger.event] ?? rule.trigger.event
  if (rule.trigger.toStageId) label += ' → stage filter'
  return label
}

function delayLabel(minutes?: number): string {
  if (!minutes) return 'Immediate'
  if (minutes < 60) return `After ${minutes}m`
  if (minutes < 1440) return `After ${Math.round(minutes / 60)}h`
  return `After ${Math.round(minutes / 1440)}d`
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    fetch('/api/v1/crm/automations')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((body) => {
        const list: AutomationRule[] = body.data?.rules ?? body.data ?? body ?? []
        setRules(Array.isArray(list) ? list : [])
      })
      .catch(() => setFetchError('Failed to load automations. Please try again.'))
      .finally(() => setLoading(false))
  }, [])

  // ── Toggle enabled ─────────────────────────────────────────────────────────

  async function handleToggle(rule: AutomationRule) {
    if (togglingId) return
    const newEnabled = !rule.enabled

    // Optimistic update
    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, enabled: newEnabled } : r))
    )
    setTogglingId(rule.id)

    try {
      const res = await fetch(`/api/v1/crm/automations/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
    } catch {
      // Rollback on error
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r))
      )
    } finally {
      setTogglingId(null)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function handleDelete(rule: AutomationRule) {
    if (!window.confirm('Delete this automation?')) return
    setDeletingId(rule.id)
    try {
      const res = await fetch(`/api/v1/crm/automations/${rule.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      setRules((prev) => prev.filter((r) => r.id !== rule.id))
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
          <h1 className="text-lg font-semibold mb-1">Automations</h1>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Automate actions when CRM events occur.
          </p>
        </div>
        <Link
          href="/portal/settings/automations/new"
          className="btn-pib-accent flex items-center gap-1.5 text-sm shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          New automation
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
      ) : fetchError ? (
        <div className="px-4 py-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-sm text-[var(--color-pib-text-muted)]">
          {fetchError}
        </div>
      ) : rules.length === 0 ? (
        <div className="bento-card !p-8 text-center">
          <span className="material-symbols-outlined text-4xl mb-2 block text-[var(--color-pib-text-muted)]">
            bolt
          </span>
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            No automations yet. Create your first rule.
          </p>
          <Link
            href="/portal/settings/automations/new"
            className="btn-pib-accent flex items-center gap-1.5 text-sm mx-auto mt-4 w-fit"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            New automation
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
                  Trigger
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">
                  Delay
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">
                  Actions
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">
                  Status
                </th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wider">
                  Edit / Delete
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, i) => {
                const isToggling = togglingId === rule.id
                const isDeleting = deletingId === rule.id

                return (
                  <tr
                    key={rule.id}
                    className={[
                      'transition-colors hover:bg-white/[0.02]',
                      i < rules.length - 1 ? 'border-b border-[var(--color-pib-line)]' : '',
                      isDeleting ? 'opacity-50 pointer-events-none' : '',
                    ].join(' ')}
                  >
                    {/* Name */}
                    <td className="px-4 py-3 font-medium max-w-[180px] truncate">
                      {rule.name}
                    </td>

                    {/* Trigger */}
                    <td className="px-4 py-3 text-[var(--color-pib-text-muted)] text-xs">
                      {triggerLabel(rule)}
                    </td>

                    {/* Delay */}
                    <td className="px-4 py-3 text-[var(--color-pib-text-muted)] text-xs whitespace-nowrap">
                      {delayLabel(rule.delayMinutes)}
                    </td>

                    {/* Actions count */}
                    <td className="px-4 py-3 text-[var(--color-pib-text-muted)] text-xs whitespace-nowrap">
                      {rule.actions.length} action{rule.actions.length !== 1 ? 's' : ''}
                    </td>

                    {/* Enabled toggle */}
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleToggle(rule)}
                        disabled={isToggling}
                        title={rule.enabled ? 'Disable automation' : 'Enable automation'}
                        className={[
                          'cursor-pointer relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none',
                          rule.enabled
                            ? 'bg-[var(--color-pib-accent)]'
                            : 'bg-[var(--color-pib-line-strong)]',
                          isToggling ? 'opacity-60' : '',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
                            rule.enabled ? 'translate-x-4' : 'translate-x-0.5',
                          ].join(' ')}
                        />
                      </button>
                    </td>

                    {/* Edit / Delete */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/portal/settings/automations/${rule.id}/edit`}
                          title="Edit automation"
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06] transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px]">edit</span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDelete(rule)}
                          disabled={isDeleting}
                          title="Delete automation"
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
