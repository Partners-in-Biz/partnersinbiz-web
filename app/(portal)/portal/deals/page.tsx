'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { DealKanban } from '@/components/crm/DealKanban'
import { PipelineSelector } from '@/components/crm/PipelineSelector'
import { DealDrawer } from '@/components/crm/DealDrawer'
import { DealDetailDrawer } from '@/components/crm/DealDetailDrawer'
import type { Deal, Currency } from '@/lib/crm/types'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'

type ViewMode = 'board' | 'list' | 'forecast'

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

// ── Pipeline value summary strip ───────────────────────────────────────────────

interface PipelineSummaryProps {
  deals: Deal[]
  stages: PipelineStage[]
}

function PipelineSummary({ deals, stages }: PipelineSummaryProps) {
  const wonStageIds = new Set(stages.filter(s => s.kind === 'won').map(s => s.id))
  const lostStageIds = new Set(stages.filter(s => s.kind === 'lost').map(s => s.id))

  const primaryCurrency: Currency = (deals.find(d => d.currency)?.currency) ?? 'ZAR'

  function fmt(v: number) {
    try {
      return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: primaryCurrency, maximumFractionDigits: 0 }).format(v)
    } catch {
      return v.toFixed(0)
    }
  }

  const total = deals
    .filter(d => !lostStageIds.has(d.stageId))
    .reduce((sum, d) => sum + (d.value ?? 0), 0)
  const won = deals
    .filter(d => wonStageIds.has(d.stageId))
    .reduce((sum, d) => sum + (d.value ?? 0), 0)
  const open = deals.filter(d => !wonStageIds.has(d.stageId) && !lostStageIds.has(d.stageId)).length

  // A5: weighted pipeline — sum of (value × probability / 100) for non-lost deals
  const weightedTotal = deals
    .filter(d => !lostStageIds.has(d.stageId))
    .reduce((sum, d) => {
      const stage = stages.find(s => s.id === d.stageId)
      const prob = d.probability ?? stage?.probability ?? 100
      return sum + (d.value ?? 0) * (prob / 100)
    }, 0)

  return (
    <div className="flex gap-4 flex-wrap">
      {[
        { label: 'Pipeline value', value: fmt(total), sub: 'excl. lost' },
        { label: 'Weighted pipeline', value: fmt(weightedTotal), sub: 'prob-adjusted' },
        { label: 'Won',            value: fmt(won),   sub: 'all time' },
        { label: 'Open deals',     value: String(open), sub: 'active' },
        { label: 'Total deals',    value: String(deals.length), sub: 'all stages' },
      ].map(stat => (
        <div
          key={stat.label}
          className="pib-card px-4 py-3 min-w-[130px]"
        >
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-0.5">{stat.label}</p>
          <p className="text-xl font-headline font-bold text-on-surface leading-none">{stat.value}</p>
          <p className="text-[10px] text-on-surface-variant mt-0.5">{stat.sub}</p>
        </div>
      ))}
    </div>
  )
}

// ── Forecast helpers ───────────────────────────────────────────────────────────

function fmtDealValue(value: number | undefined, currency?: string) {
  if (!value) return '—'
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency', currency: currency ?? 'ZAR', maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency ?? 'ZAR'} ${value.toFixed(0)}`
  }
}

function formatDealsTotal(deals: Deal[], mode: 'value' | 'weighted') {
  const total = deals.reduce((s, d) => {
    if (mode === 'weighted') return s + (d.value ?? 0) * ((d.probability ?? 50) / 100)
    return s + (d.value ?? 0)
  }, 0)
  return fmtDealValue(total, deals.find(d => d.currency)?.currency)
}

function fmtRelativeDate(ts: unknown): string {
  const date = ts && typeof ts === 'object' && 'toDate' in ts
    ? (ts as { toDate: () => Date }).toDate()
    : new Date(ts as string)
  if (isNaN(date.getTime())) return '—'
  const diffDays = Math.round((date.getTime() - Date.now()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`
  return `in ${diffDays}d`
}

function ProbabilityInput({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, prob: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(deal.probability ?? 50))

  if (!editing) return (
    <button
      onClick={() => setEditing(true)}
      className="hover:underline text-right w-full cursor-pointer"
    >
      {deal.probability ?? 50}%
    </button>
  )

  return (
    <input
      type="number"
      min={0}
      max={100}
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={() => {
        const n = Math.max(0, Math.min(100, Number(val)))
        onUpdate(deal.id, n)
        setEditing(false)
      }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="w-14 text-right border border-[var(--color-pib-accent)] rounded px-1 bg-transparent"
      autoFocus
    />
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [pipelinesLoading, setPipelinesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('board')

  // A5: drawer state
  const [showCreateDrawer, setShowCreateDrawer] = useState(false)
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null)
  const [viewingDeal, setViewingDeal] = useState<Deal | null>(null)

  // Fetch pipelines once on mount
  useEffect(() => {
    let cancelled = false
    setPipelinesLoading(true)
    fetch('/api/v1/crm/pipelines')
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        if (!body.success) throw new Error(body.error ?? 'Failed to load pipelines')
        const list: Pipeline[] = body.data ?? []
        setPipelines(list)
        // Auto-select default pipeline
        const defaultPl = list.find(p => p.isDefault) ?? list[0]
        if (defaultPl) setSelectedPipelineId(defaultPl.id)
        setPipelinesLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message ?? 'Failed to load pipelines')
        setPipelinesLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // Fetch deals whenever selected pipeline changes
  useEffect(() => {
    if (!selectedPipelineId) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/v1/crm/deals?pipelineId=${encodeURIComponent(selectedPipelineId)}&limit=200`)
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        if (!body.success) throw new Error(body.error ?? 'Failed to load deals')
        setDeals(body.data ?? [])
        setStageFilter('all') // reset filter on pipeline switch
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message ?? 'Failed to load deals')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedPipelineId])

  const selectedPipeline = pipelines.find(p => p.id === selectedPipelineId)
  const stages: PipelineStage[] = selectedPipeline
    ? [...selectedPipeline.stages].sort((a, b) => a.order - b.order)
    : []

  const handleStageChange = useCallback(async (dealId: string, newStageId: string) => {
    // Optimistic update happens inside DealKanban; we just fire the PATCH
    const res = await fetch(`/api/v1/crm/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId: newStageId }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to update deal stage')
    }
    // Sync local list so list-view stays consistent
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stageId: newStageId } : d))
  }, [])

  const handlePipelineChange = useCallback((id: string) => {
    setSelectedPipelineId(id)
    setDeals([])
    setError(null)
  }, [])

  // A5: deal saved callback — refresh the deal list
  const handleDealSaved = useCallback((_dealId: string) => {
    setShowCreateDrawer(false)
    setEditingDeal(null)
    setViewingDeal(null)
    if (selectedPipelineId) {
      setLoading(true)
      fetch(`/api/v1/crm/deals?pipelineId=${encodeURIComponent(selectedPipelineId)}&limit=200`)
        .then(r => r.json())
        .then(body => { if (body.success) setDeals(body.data ?? []) })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
  }, [selectedPipelineId])

  const handleProbabilityUpdate = useCallback(async (dealId: string, probability: number) => {
    // Optimistic update
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, probability } : d))
    // Persist best-effort
    await fetch(`/api/v1/crm/deals/${dealId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probability }),
    }).catch(() => {})
  }, [])

  const filteredDeals = stageFilter === 'all' ? deals : deals.filter(d => d.stageId === stageFilter)

  // Open deals for forecast view: exclude lost-stage deals
  const lostStageIds = new Set(stages.filter(s => s.kind === 'lost').map(s => s.id))
  const wonStageIds = new Set(stages.filter(s => s.kind === 'won').map(s => s.id))
  const openDeals = deals
    .filter(d => !lostStageIds.has(d.stageId) && !wonStageIds.has(d.stageId))
    .slice()
    .sort((a, b) => {
      const aDate = a.expectedCloseDate
      const bDate = b.expectedCloseDate
      if (!aDate && !bDate) return 0
      if (!aDate) return 1
      if (!bDate) return -1
      const aMs = typeof aDate === 'object' && 'toDate' in aDate
        ? (aDate as { toDate: () => Date }).toDate().getTime()
        : new Date(aDate as unknown as string).getTime()
      const bMs = typeof bDate === 'object' && 'toDate' in bDate
        ? (bDate as { toDate: () => Date }).toDate().getTime()
        : new Date(bDate as unknown as string).getTime()
      return aMs - bMs
    })

  const isReady = !pipelinesLoading && !loading

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">CRM / Deals</p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Pipeline</h1>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Pipeline selector */}
          {pipelines.length > 0 && (
            <PipelineSelector
              pipelines={pipelines}
              selectedId={selectedPipelineId}
              onChange={handlePipelineChange}
              className="w-48"
            />
          )}

          {/* New deal button */}
          <button
            onClick={() => setShowCreateDrawer(true)}
            className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            New deal
          </button>

          {/* View toggle */}
          <div
            className="flex rounded-[var(--radius-btn)] overflow-hidden border"
            style={{ borderColor: 'var(--color-outline)' }}
          >
            {([
              { id: 'board', label: 'Board', icon: 'view_kanban' },
              { id: 'list', label: 'List', icon: 'list' },
              { id: 'forecast', label: 'Forecast', icon: 'trending_up' },
            ] as const).map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setViewMode(id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-label capitalize transition-colors cursor-pointer"
                style={
                  viewMode === id
                    ? { background: 'var(--color-accent-v2)', color: '#000' }
                    : { background: 'transparent', color: 'var(--color-on-surface-variant)' }
                }
              >
                <span className="material-symbols-outlined text-[14px]">{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary strip */}
      {isReady && !error && <PipelineSummary deals={deals} stages={stages} />}

      {/* Stage filter pills */}
      {stages.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {(['all', ...stages.map(s => s.id)] as const).map(s => {
            const stage = stages.find(st => st.id === s)
            return (
              <button
                key={s}
                onClick={() => setStageFilter(s)}
                className={[
                  'text-xs font-label px-3 py-1.5 rounded-[var(--radius-btn)] transition-colors capitalize',
                  stageFilter === s
                    ? 'text-black font-medium'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container',
                ].join(' ')}
                style={stageFilter === s ? { background: 'var(--color-accent-v2)' } : {}}
              >
                {s === 'all' ? 'All stages' : (stage?.label ?? s)}
              </button>
            )
          })}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          className="rounded-[var(--radius-card)] px-4 py-3 text-sm"
          style={{ background: '#ef444420', color: '#f87171', border: '1px solid #ef444430' }}
        >
          {error}
        </div>
      )}

      {/* Board view */}
      {!error && viewMode === 'board' && stages.length > 0 && (
        loading ? (
          <DealKanban deals={[]} stages={stages} loading onStageChange={handleStageChange} />
        ) : filteredDeals.length === 0 && stageFilter === 'all' ? (
          <div className="pib-card py-16 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant block mb-3">
              monetization_on
            </span>
            <p className="text-on-surface-variant text-sm">No deals yet.</p>
            <p className="text-on-surface-variant text-xs mt-1">Deals you create will appear here as a kanban pipeline.</p>
          </div>
        ) : (
          <DealKanban deals={filteredDeals} stages={stages} onStageChange={handleStageChange} />
        )
      )}

      {/* Board loading state when pipeline not yet loaded */}
      {!error && viewMode === 'board' && stages.length === 0 && pipelinesLoading && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex flex-col w-64 shrink-0 gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ))}
        </div>
      )}

      {/* List view */}
      {!error && viewMode === 'list' && (
        loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : filteredDeals.length === 0 ? (
          <div className="pib-card py-12 text-center">
            <p className="text-on-surface-variant text-sm">No deals found.</p>
          </div>
        ) : (
          <div className="pib-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--color-card-border)' }}>
                  {['Deal', 'Stage', 'Value', 'Prob', 'Weighted', 'Contact'].map(h => (
                    <th
                      key={h}
                      className="text-left text-[10px] font-label uppercase tracking-widest text-on-surface-variant px-4 py-2.5"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredDeals.map(deal => {
                  const stage = stages.find(s => s.id === deal.stageId)
                  const stageColor = stage?.color ?? stageColorByKind(stage?.kind)
                  const stageLabel = stage?.label ?? deal.stageId
                  const prob = deal.probability ?? stage?.probability ?? 100
                  const weighted = (deal.value ?? 0) * (prob / 100)
                  return (
                    <tr
                      key={deal.id}
                      className="border-b transition-colors hover:bg-[var(--color-surface-container)] cursor-pointer"
                      style={{ borderColor: 'var(--color-card-border)' }}
                      onClick={() => setViewingDeal(deal)}
                    >
                      <td className="px-4 py-3 font-medium text-on-surface">
                        <Link
                          href={`/portal/deals/${deal.id}`}
                          className="hover:text-[var(--color-pib-accent)] transition-colors font-medium"
                          onClick={e => e.stopPropagation()}
                        >
                          {deal.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
                          style={{
                            background: `${stageColor}20`,
                            color: stageColor,
                          }}
                        >
                          {stageLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-on-surface-variant text-xs">
                        {deal.currency} {deal.value?.toFixed(0)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        <span
                          className="px-1.5 py-0.5 rounded-full text-[10px]"
                          style={{
                            background: prob >= 70 ? '#4ade8020' : prob >= 40 ? '#facc1520' : '#f8717120',
                            color: prob >= 70 ? '#4ade80' : prob >= 40 ? '#facc15' : '#f87171',
                          }}
                        >
                          {prob}%
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-on-surface-variant text-xs">
                        {deal.currency} {weighted.toFixed(0)}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {deal.contactId ? (
                          <a
                            href={`/portal/crm/contacts/${deal.contactId}`}
                            className="text-xs text-[var(--color-accent-v2)] hover:underline"
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-xs text-on-surface-variant">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}
      {/* Forecast view */}
      {!error && viewMode === 'forecast' && (
        loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : (
          <div className="bento-card !p-0 overflow-hidden">
            {/* Summary bar */}
            <div className="flex gap-6 px-5 py-3 border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
              <div>
                <span className="text-xs text-[var(--color-pib-text-muted)]">Total value</span>
                <span className="ml-2 text-sm font-semibold">{formatDealsTotal(openDeals, 'value')}</span>
              </div>
              <div>
                <span className="text-xs text-[var(--color-pib-text-muted)]">Weighted</span>
                <span className="ml-2 text-sm font-semibold text-[var(--color-pib-accent)]">{formatDealsTotal(openDeals, 'weighted')}</span>
              </div>
            </div>

            {/* Table */}
            <table className="w-full text-sm">
              <thead className="text-xs text-[var(--color-pib-text-muted)] border-b border-[var(--color-pib-line)]">
                <tr>
                  <th className="text-left px-4 py-2">Deal</th>
                  <th className="text-left px-4 py-2 hidden md:table-cell">Stage</th>
                  <th className="text-right px-4 py-2">Value</th>
                  <th className="text-right px-4 py-2">Prob %</th>
                  <th className="text-right px-4 py-2">Weighted</th>
                  <th className="text-right px-4 py-2 hidden lg:table-cell">Close Date</th>
                </tr>
              </thead>
              <tbody>
                {openDeals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[var(--color-pib-text-muted)]">No open deals</td>
                  </tr>
                ) : (
                  openDeals.map(deal => {
                    const stage = stages.find(s => s.id === deal.stageId)
                    const stageLabel = stage?.label ?? deal.stageId
                    const prob = deal.probability ?? stage?.probability ?? 50
                    const weighted = (deal.value ?? 0) * (prob / 100)
                    return (
                      <tr
                        key={deal.id}
                        className="border-b border-[var(--color-pib-line)] last:border-0 hover:bg-[var(--color-pib-surface)] transition-colors"
                      >
                        <td className="px-4 py-3 font-medium">
                          <Link
                            href={`/portal/deals/${deal.id}`}
                            className="hover:text-[var(--color-pib-accent)] transition-colors"
                          >
                            {deal.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-[var(--color-pib-text-muted)] hidden md:table-cell">{stageLabel}</td>
                        <td className="px-4 py-3 text-right">{fmtDealValue(deal.value, deal.currency)}</td>
                        <td className="px-4 py-3 text-right">
                          <ProbabilityInput deal={deal} onUpdate={handleProbabilityUpdate} />
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--color-pib-accent)]">
                          {fmtDealValue(weighted, deal.currency)}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--color-pib-text-muted)] hidden lg:table-cell">
                          {deal.expectedCloseDate ? fmtRelativeDate(deal.expectedCloseDate) : '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* A5: Create deal drawer */}
      {showCreateDrawer && (
        <DealDrawer
          defaultPipelineId={selectedPipelineId}
          onSaved={handleDealSaved}
          onClose={() => setShowCreateDrawer(false)}
          orgId={''}
        />
      )}

      {/* A5: Edit deal drawer */}
      {editingDeal && (
        <DealDrawer
          deal={editingDeal}
          onSaved={handleDealSaved}
          onClose={() => setEditingDeal(null)}
          orgId={''}
        />
      )}

      {/* A5: Deal detail drawer */}
      {viewingDeal && !editingDeal && (
        <DealDetailDrawer
          deal={viewingDeal}
          stages={stages}
          orgId={''}
          onClose={() => setViewingDeal(null)}
          onEdit={() => { setEditingDeal(viewingDeal); setViewingDeal(null) }}
        />
      )}
    </div>
  )
}

// Helper: fallback color by stage kind when no custom color is set
function stageColorByKind(kind?: string): string {
  if (kind === 'won')  return '#4ade80'
  if (kind === 'lost') return '#ef4444'
  return '#60a5fa' // open stages default to blue
}
