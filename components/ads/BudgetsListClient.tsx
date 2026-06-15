'use client'

import { useState } from 'react'
import Link from 'next/link'
import { BudgetPaceMeter } from './BudgetPaceMeter'
import { PageTabs } from '@/components/ui/AppFoundation'

type BudgetScope = 'org' | 'platform' | 'campaign'

export interface BudgetRow {
  id: string
  name: string
  scope: BudgetScope
  platform?: string
  campaignId?: string
  period: string
  capCents: number
  currencyCode: string
  currentSpendPercent?: number
  currentSpendCents?: number
  archivedAt?: unknown
}

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'org', label: 'Org' },
  { key: 'platform', label: 'Per-Platform' },
  { key: 'campaign', label: 'Per-Campaign' },
  { key: 'archived', label: 'Archived' },
] as const

type FilterKey = (typeof FILTER_TABS)[number]['key']

const SCOPE_BADGE: Record<BudgetScope, string> = {
  org: 'bg-sky-500/10 text-sky-300',
  platform: 'bg-violet-500/10 text-violet-300',
  campaign: 'bg-[#F5A623]/10 text-[#F5A623]',
}

const PERIOD_CHIP: Record<string, string> = {
  daily: 'bg-white/5 text-white/50',
  weekly: 'bg-white/5 text-white/50',
  monthly: 'bg-white/5 text-white/50',
}

interface Props {
  budgets: BudgetRow[]
  orgSlug: string
}

export function BudgetsListClient({ budgets, orgSlug }: Props) {
  const [visibleBudgets, setVisibleBudgets] = useState<BudgetRow[]>(budgets)
  const [activeTab, setActiveTab] = useState<FilterKey>('all')
  const [checking, setChecking] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState<BudgetRow | null>(null)
  const [archiving, setArchiving] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const filtered = visibleBudgets.filter((b) => {
    if (activeTab === 'all') return !b.archivedAt
    if (activeTab === 'archived') return !!b.archivedAt
    if (activeTab === 'org') return b.scope === 'org' && !b.archivedAt
    if (activeTab === 'platform') return b.scope === 'platform' && !b.archivedAt
    if (activeTab === 'campaign') return b.scope === 'campaign' && !b.archivedAt
    return true
  })

  async function runCheck(budgetId: string) {
    setChecking(budgetId)
    try {
      await fetch(`/api/v1/ads/budgets/${budgetId}/check`, { method: 'POST' })
    } finally {
      setChecking(null)
    }
  }

  function requestArchive(budget: BudgetRow) {
    setActionMessage(null)
    setActionError(null)
    setConfirmArchive(budget)
  }

  async function archiveBudget(budget: BudgetRow) {
    setArchiving(budget.id)
    setActionMessage(null)
    setActionError(null)
    try {
      const response = await fetch(`/api/v1/ads/budgets/${budget.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Budget archive failed')
      setVisibleBudgets((current) =>
        current.map((item) =>
          item.id === budget.id ? { ...item, archivedAt: item.archivedAt ?? new Date().toISOString() } : item,
        ),
      )
      setConfirmArchive(null)
      setActionMessage(`Budget ${budget.name} archived.`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Budget archive failed')
    } finally {
      setArchiving(null)
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Budgets</h1>
        <Link
          href={`/admin/org/${orgSlug}/ads/budgets/new`}
          className="btn-pib-accent text-sm"
        >
          + New budget
        </Link>
      </header>

      <PageTabs
        ariaLabel="Budget filters"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as FilterKey)}
        tabs={FILTER_TABS.map((tab) => ({ label: tab.label, value: tab.key }))}
      />

      {actionMessage && (
        <div role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {actionMessage}
        </div>
      )}

      {actionError && (
        <div role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {actionError}
        </div>
      )}

      {confirmArchive && (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="budget-archive-title"
          aria-describedby="budget-archive-description"
          className="rounded-lg border border-[#F5A623]/30 bg-[#F5A623]/10 p-4 shadow-sm"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 id="budget-archive-title" className="text-sm font-semibold text-white">
                Archive budget {confirmArchive.name} for {orgSlug}?
              </h2>
              <p id="budget-archive-description" className="text-sm text-white/65">
                This removes {confirmArchive.name} from active admin budget pacing. Historical spend and alerts stay in PiB; it does not approve or increase paid spend.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setConfirmArchive(null)}
                disabled={archiving === confirmArchive.id}
                className="rounded border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:text-white disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => archiveBudget(confirmArchive)}
                disabled={archiving === confirmArchive.id}
                aria-label={`Confirm archive budget ${confirmArchive.name} for ${orgSlug}`}
                className="rounded border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-40"
              >
                {archiving === confirmArchive.id ? 'Archiving...' : 'Archive budget'}
              </button>
            </div>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-8 text-center">
          <p className="text-white/60">No budgets found.</p>
          {activeTab === 'all' && (
            <Link
              href={`/admin/org/${orgSlug}/ads/budgets/new`}
              className="mt-3 inline-block text-sm text-[#F5A623] underline"
            >
              Create an admin budget guardrail →
            </Link>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {filtered.map((b) => (
            <li key={b.id} aria-label={`Budget ${b.name}`} className="px-5 py-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/org/${orgSlug}/ads/budgets/${b.id}`}
                      className="font-medium hover:text-[#F5A623]"
                    >
                      {b.name}
                    </Link>
                    <span
                      className={`rounded px-2 py-0.5 text-xs uppercase tracking-wide ${
                        SCOPE_BADGE[b.scope]
                      }`}
                    >
                      {b.scope}
                    </span>
                    {b.platform && (
                      <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-white/50">
                        {b.platform}
                      </span>
                    )}
                    {b.campaignId && (
                      <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-white/40 font-mono">
                        {b.campaignId}
                      </span>
                    )}
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${PERIOD_CHIP[b.period] ?? 'bg-white/5 text-white/50'}`}
                    >
                      {b.period}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  <Link
                    href={`/admin/org/${orgSlug}/ads/budgets/${b.id}`}
                    className="rounded border border-white/10 px-2 py-1 text-white/60 hover:text-white"
                  >
                    View
                  </Link>
                  <button
                    onClick={() => runCheck(b.id)}
                    disabled={checking === b.id}
                    className="rounded border border-white/10 px-2 py-1 text-white/60 hover:text-white disabled:opacity-40"
                  >
                    {checking === b.id ? 'Checking…' : 'Run check'}
                  </button>
                  {!b.archivedAt && (
                    <button
                      type="button"
                      onClick={() => requestArchive(b)}
                      disabled={archiving === b.id}
                      aria-label={`Archive budget ${b.name} for ${orgSlug}`}
                      className="rounded border border-white/10 px-2 py-1 text-white/40 hover:text-red-400 disabled:opacity-40"
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>
              <BudgetPaceMeter
                percent={b.currentSpendPercent ?? 0}
                spendCents={b.currentSpendCents}
                capCents={b.capCents}
                currencyCode={b.currencyCode}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
