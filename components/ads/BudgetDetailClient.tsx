'use client'

import { useState } from 'react'
import { BudgetPaceMeter } from './BudgetPaceMeter'
import { BudgetCapEditor } from './BudgetCapEditor'

interface Budget {
  id: string
  orgId: string
  name: string
  description?: string
  scope: 'org' | 'platform' | 'campaign'
  platform?: string
  campaignId?: string
  capCents: number
  currencyCode: string
  period: string
  currentSpendCents?: number
  currentSpendPercent?: number
  autoPause: boolean
  autoResumeOnRollover?: boolean
  alertThresholds: number[]
  archivedAt?: unknown
}

interface BudgetEvent {
  id: string
  type: 'pacing_check' | 'threshold_alert' | 'exhausted' | 'auto_paused' | 'reset'
  spendCents: number
  percent: number
  threshold?: number
  pausedCampaignIds?: string[]
  occurredAt: { seconds: number }
}

const EVENT_ICON: Record<BudgetEvent['type'], string> = {
  pacing_check: '📊',
  threshold_alert: '⚠️',
  exhausted: '🔴',
  auto_paused: '⏸️',
  reset: '🔄',
}

interface Props {
  budget: Budget
  events: BudgetEvent[]
  orgSlug: string
}

export function BudgetDetailClient({ budget, events, orgSlug }: Props) {
  const [showEdit, setShowEdit] = useState(false)
  const [checking, setChecking] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const fmt = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: budget.currencyCode }).format(
      cents / 100,
    )

  async function runCheck() {
    setChecking(true)
    setActionMsg(null)
    try {
      const res = await fetch(`/api/v1/ads/budgets/${budget.id}/check`, {
        method: 'POST',
        headers: { 'X-Org-Id': budget.orgId },
      })
      const json = await res.json()
      if (json.success) {
        const d = json.data
        setActionMsg(
          `Check complete — ${d.percent?.toFixed(1)}% spent. ${d.exhausted ? 'Budget exhausted.' : ''}`,
        )
      } else {
        setActionMsg(`Error: ${json.error ?? 'Unknown'}`)
      }
    } catch {
      setActionMsg('Check failed.')
    } finally {
      setChecking(false)
    }
  }

  async function resetPeriod() {
    if (!confirm('Reset this budget period? Spend tracking will restart from 0.')) return
    setResetting(true)
    setActionMsg(null)
    try {
      const res = await fetch(`/api/v1/ads/budgets/${budget.id}/reset`, {
        method: 'POST',
        headers: { 'X-Org-Id': budget.orgId },
      })
      const json = await res.json()
      if (json.success) {
        setActionMsg('Period reset. Refreshing…')
        setTimeout(() => window.location.reload(), 1000)
      } else {
        setActionMsg(`Error: ${json.error ?? 'Unknown'}`)
      }
    } catch {
      setActionMsg('Reset failed.')
    } finally {
      setResetting(false)
    }
  }

  async function archiveBudget() {
    if (!confirm('Archive this budget?')) return
    await fetch(`/api/v1/ads/budgets/${budget.id}`, {
      method: 'DELETE',
      headers: { 'X-Org-Id': budget.orgId },
    })
    window.location.href = `/admin/org/${orgSlug}/ads/budgets`
  }

  function formatTs(ts: { seconds: number }) {
    return new Date(ts.seconds * 1000).toLocaleString()
  }

  return (
    <article className="space-y-6">
      {/* Pace meter */}
      <div className="rounded-lg border border-white/10 p-4">
        <BudgetPaceMeter
          percent={budget.currentSpendPercent ?? 0}
          spendCents={budget.currentSpendCents}
          capCents={budget.capCents}
          currencyCode={budget.currencyCode}
        />
      </div>

      {/* Status row */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-white/10 p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-white/40">Period</dt>
          <dd className="font-medium capitalize">{budget.period}</dd>
        </div>
        <div>
          <dt className="text-white/40">Scope</dt>
          <dd className="font-medium capitalize">{budget.scope}</dd>
        </div>
        {budget.platform && (
          <div>
            <dt className="text-white/40">Platform</dt>
            <dd className="font-medium capitalize">{budget.platform}</dd>
          </div>
        )}
        {budget.campaignId && (
          <div>
            <dt className="text-white/40">Campaign ID</dt>
            <dd className="font-mono text-xs text-white/60">{budget.campaignId}</dd>
          </div>
        )}
        <div>
          <dt className="text-white/40">Cap</dt>
          <dd className="font-medium">{fmt(budget.capCents)}</dd>
        </div>
        <div>
          <dt className="text-white/40">Currency</dt>
          <dd className="font-medium">{budget.currencyCode}</dd>
        </div>
        <div>
          <dt className="text-white/40">Auto-pause</dt>
          <dd className="font-medium">{budget.autoPause ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt className="text-white/40">Alert thresholds</dt>
          <dd className="font-medium">{budget.alertThresholds.join(', ')}%</dd>
        </div>
      </dl>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={runCheck}
          disabled={checking}
          className="rounded border border-white/10 px-4 py-2 text-sm text-white/70 hover:text-white disabled:opacity-50"
        >
          {checking ? 'Running check…' : 'Run check'}
        </button>
        <button
          onClick={resetPeriod}
          disabled={resetting}
          className="rounded border border-white/10 px-4 py-2 text-sm text-white/70 hover:text-white disabled:opacity-50"
        >
          {resetting ? 'Resetting…' : 'Reset period'}
        </button>
        {!budget.archivedAt && (
          <button
            onClick={() => setShowEdit((v) => !v)}
            className="rounded border border-[#F5A623]/30 px-4 py-2 text-sm text-[#F5A623] hover:border-[#F5A623]"
          >
            {showEdit ? 'Cancel edit' : 'Edit'}
          </button>
        )}
        {!budget.archivedAt && (
          <button
            onClick={archiveBudget}
            className="rounded border border-white/10 px-4 py-2 text-sm text-white/40 hover:text-red-400"
          >
            Archive
          </button>
        )}
        {actionMsg && (
          <span className="text-sm text-white/60">{actionMsg}</span>
        )}
      </div>

      {/* Edit form (collapsible) */}
      {showEdit && (
        <div className="rounded-lg border border-white/10 p-5">
          <h2 className="mb-4 text-sm font-semibold text-white/80">Edit budget</h2>
          <BudgetCapEditor
            orgId={budget.orgId}
            orgSlug={orgSlug}
            budgetId={budget.id}
            initial={{
              name: budget.name,
              description: budget.description,
              capMajor: budget.capCents / 100,
              currencyCode: budget.currencyCode,
              alertThresholds: budget.alertThresholds,
              autoPause: budget.autoPause,
              autoResumeOnRollover: budget.autoResumeOnRollover,
            }}
            onSaved={() => {
              setShowEdit(false)
              window.location.reload()
            }}
            onCancel={() => setShowEdit(false)}
          />
        </div>
      )}

      {/* Events timeline */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wide">
          Events ({events.length})
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-white/40">No events recorded yet.</p>
        ) : (
          <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
            {events.map((ev) => (
              <li key={ev.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="text-base leading-tight" aria-hidden>
                  {EVENT_ICON[ev.type] ?? '•'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium capitalize">{ev.type.replace(/_/g, ' ')}</span>
                    {ev.threshold != null && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-300">
                        @ {ev.threshold}%
                      </span>
                    )}
                    {ev.pausedCampaignIds?.length ? (
                      <span className="text-xs text-white/40">
                        {ev.pausedCampaignIds.length} paused
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-white/40">
                    {fmt(ev.spendCents)} · {ev.percent.toFixed(1)}% · {formatTs(ev.occurredAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}
