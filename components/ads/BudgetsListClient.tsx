'use client'

import { useState } from 'react'
import Link from 'next/link'
import { BudgetPaceMeter } from './BudgetPaceMeter'

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
  const [activeTab, setActiveTab] = useState<FilterKey>('all')
  const [checking, setChecking] = useState<string | null>(null)

  const filtered = budgets.filter((b) => {
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

  async function archiveBudget(budgetId: string) {
    if (!confirm('Archive this budget?')) return
    await fetch(`/api/v1/ads/budgets/${budgetId}`, { method: 'DELETE' })
    window.location.reload()
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

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-white/10 pb-0" role="tablist">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm transition-colors ${
              activeTab === tab.key
                ? 'border-b-2 border-[#F5A623] text-white'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-8 text-center">
          <p className="text-white/60">No budgets found.</p>
          {activeTab === 'all' && (
            <Link
              href={`/admin/org/${orgSlug}/ads/budgets/new`}
              className="mt-3 inline-block text-sm text-[#F5A623] underline"
            >
              Create your first budget →
            </Link>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {filtered.map((b) => (
            <li key={b.id} className="px-5 py-4 space-y-3">
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
                      onClick={() => archiveBudget(b.id)}
                      className="rounded border border-white/10 px-2 py-1 text-white/40 hover:text-red-400"
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
