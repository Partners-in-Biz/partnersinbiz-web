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
  const [currentBudget, setCurrentBudget] = useState(budget)
  const [showEdit, setShowEdit] = useState(false)
  const [checking, setChecking] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'reset' | 'archive' | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const fmt = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: currentBudget.currencyCode }).format(
      cents / 100,
    )

  async function runCheck() {
    setChecking(true)
    setActionMsg(null)
    setActionError(null)
    try {
      const res = await fetch(`/api/v1/ads/budgets/${currentBudget.id}/check`, {
        method: 'POST',
        headers: { 'X-Org-Id': currentBudget.orgId },
      })
      const json = await res.json()
      if (json.success) {
        const d = json.data
        setActionMsg(
          `Check complete — ${d.percent?.toFixed(1)}% spent. ${d.exhausted ? 'Budget exhausted.' : ''}`,
        )
      } else {
        setActionError(json.error ?? 'Budget check failed')
      }
    } catch {
      setActionError('Check failed.')
    } finally {
      setChecking(false)
    }
  }

  function requestReset() {
    setActionMsg(null)
    setActionError(null)
    setConfirmAction('reset')
  }

  async function resetPeriod() {
    setResetting(true)
    setActionMsg(null)
    setActionError(null)
    try {
      const res = await fetch(`/api/v1/ads/budgets/${currentBudget.id}/reset`, {
        method: 'POST',
        headers: { 'X-Org-Id': currentBudget.orgId },
      })
      const json = await res.json()
      if (json.success) {
        setCurrentBudget((current) => ({
          ...current,
          currentSpendCents: json.data?.currentSpendCents ?? 0,
          currentSpendPercent: json.data?.currentSpendPercent ?? 0,
        }))
        setConfirmAction(null)
        setActionMsg('Budget period reset. Spend tracking is back at 0.')
      } else {
        setActionError(json.error ?? 'Budget reset failed')
      }
    } catch {
      setActionError('Reset failed.')
    } finally {
      setResetting(false)
    }
  }

  function requestArchive() {
    setActionMsg(null)
    setActionError(null)
    setConfirmAction('archive')
  }

  async function archiveBudget() {
    setArchiving(true)
    setActionMsg(null)
    setActionError(null)
    try {
      const res = await fetch(`/api/v1/ads/budgets/${currentBudget.id}`, {
        method: 'DELETE',
        headers: { 'X-Org-Id': currentBudget.orgId },
      })
      if (!res.ok) throw new Error('Budget archive failed')
      setCurrentBudget((current) => ({ ...current, archivedAt: current.archivedAt ?? new Date().toISOString() }))
      setConfirmAction(null)
      setActionMsg(`Budget ${currentBudget.name} archived.`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Budget archive failed')
    } finally {
      setArchiving(false)
    }
  }

  function formatTs(ts: { seconds: number }) {
    return new Date(ts.seconds * 1000).toLocaleString()
  }

  return (
    <article className="space-y-6">
      {/* Pace meter */}
      <div className="rounded-lg border border-white/10 p-4">
        <BudgetPaceMeter
          percent={currentBudget.currentSpendPercent ?? 0}
          spendCents={currentBudget.currentSpendCents}
          capCents={currentBudget.capCents}
          currencyCode={currentBudget.currencyCode}
        />
      </div>

      {actionMsg && (
        <div role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {actionMsg}
        </div>
      )}

      {actionError && (
        <div role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {actionError}
        </div>
      )}

      {confirmAction && (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="budget-detail-confirm-title"
          aria-describedby="budget-detail-confirm-description"
          className="rounded-lg border border-[#F5A623]/30 bg-[#F5A623]/10 p-4 shadow-sm"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 id="budget-detail-confirm-title" className="text-sm font-semibold text-white">
                {confirmAction === 'reset'
                  ? `Reset budget period for ${currentBudget.name}?`
                  : `Archive budget ${currentBudget.name} for ${orgSlug}?`}
              </h2>
              <p id="budget-detail-confirm-description" className="text-sm text-white/65">
                {confirmAction === 'reset'
                  ? `Spend tracking restarts at 0 for the current ${currentBudget.period} period. Historical budget events stay in PiB.`
                  : `This removes ${currentBudget.name} from active pacing controls. Historical spend and events stay in PiB.`}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                disabled={resetting || archiving}
                className="rounded border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:text-white disabled:opacity-40"
              >
                Cancel
              </button>
              {confirmAction === 'reset' ? (
                <button
                  type="button"
                  onClick={resetPeriod}
                  disabled={resetting}
                  aria-label={`Confirm reset period for budget ${currentBudget.name}`}
                  className="rounded border border-[#F5A623]/40 bg-[#F5A623]/10 px-3 py-1.5 text-xs font-medium text-[#F5A623] hover:bg-[#F5A623]/20 disabled:opacity-40"
                >
                  {resetting ? 'Resetting...' : 'Reset period'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={archiveBudget}
                  disabled={archiving}
                  aria-label={`Confirm archive budget ${currentBudget.name} for ${orgSlug}`}
                  className="rounded border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-40"
                >
                  {archiving ? 'Archiving...' : 'Archive budget'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status row */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-white/10 p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-white/40">Period</dt>
          <dd className="font-medium capitalize">{currentBudget.period}</dd>
        </div>
        <div>
          <dt className="text-white/40">Scope</dt>
          <dd className="font-medium capitalize">{currentBudget.scope}</dd>
        </div>
        {currentBudget.platform && (
          <div>
            <dt className="text-white/40">Platform</dt>
            <dd className="font-medium capitalize">{currentBudget.platform}</dd>
          </div>
        )}
        {currentBudget.campaignId && (
          <div>
            <dt className="text-white/40">Campaign ID</dt>
            <dd className="font-mono text-xs text-white/60">{currentBudget.campaignId}</dd>
          </div>
        )}
        <div>
          <dt className="text-white/40">Cap</dt>
          <dd className="font-medium">{fmt(currentBudget.capCents)}</dd>
        </div>
        <div>
          <dt className="text-white/40">Currency</dt>
          <dd className="font-medium">{currentBudget.currencyCode}</dd>
        </div>
        <div>
          <dt className="text-white/40">Auto-pause</dt>
          <dd className="font-medium">{currentBudget.autoPause ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt className="text-white/40">Alert thresholds</dt>
          <dd className="font-medium">{currentBudget.alertThresholds.join(', ')}%</dd>
        </div>
      </dl>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={runCheck}
          disabled={checking}
          aria-label={`Run pacing check for budget ${currentBudget.name}`}
          className="rounded border border-white/10 px-4 py-2 text-sm text-white/70 hover:text-white disabled:opacity-50"
        >
          {checking ? 'Running check…' : 'Run check'}
        </button>
        <button
          onClick={requestReset}
          disabled={resetting}
          aria-label={`Reset period for budget ${currentBudget.name}`}
          className="rounded border border-white/10 px-4 py-2 text-sm text-white/70 hover:text-white disabled:opacity-50"
        >
          {resetting ? 'Resetting…' : 'Reset period'}
        </button>
        {!currentBudget.archivedAt && (
          <button
            onClick={() => setShowEdit((v) => !v)}
            aria-label={`${showEdit ? 'Cancel edit for' : 'Edit'} budget ${currentBudget.name}`}
            className="rounded border border-[#F5A623]/30 px-4 py-2 text-sm text-[#F5A623] hover:border-[#F5A623]"
          >
            {showEdit ? 'Cancel edit' : 'Edit'}
          </button>
        )}
        {!currentBudget.archivedAt && (
          <button
            onClick={requestArchive}
            disabled={archiving}
            aria-label={`Archive budget ${currentBudget.name} for ${orgSlug}`}
            className="rounded border border-white/10 px-4 py-2 text-sm text-white/40 hover:text-red-400"
          >
            Archive
          </button>
        )}
      </div>

      {/* Edit form (collapsible) */}
      {showEdit && (
        <div className="rounded-lg border border-white/10 p-5">
          <h2 className="mb-4 text-sm font-semibold text-white/80">Edit budget</h2>
          <BudgetCapEditor
            orgId={budget.orgId}
            orgSlug={orgSlug}
            budgetId={currentBudget.id}
            initial={{
              name: currentBudget.name,
              description: currentBudget.description,
              capMajor: currentBudget.capCents / 100,
              currencyCode: currentBudget.currencyCode,
              alertThresholds: currentBudget.alertThresholds,
              autoPause: currentBudget.autoPause,
              autoResumeOnRollover: currentBudget.autoResumeOnRollover,
            }}
            onSaved={() => {
              setShowEdit(false)
              setActionMsg('Budget settings saved.')
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
