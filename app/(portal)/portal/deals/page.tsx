'use client'

import { useEffect, useState, useCallback } from 'react'
import { DealKanban } from '@/components/crm/DealKanban'
import { PipelineSelector } from '@/components/crm/PipelineSelector'
import type { Deal } from '@/lib/crm/types'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'

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

  const total = deals
    .filter(d => !lostStageIds.has(d.stageId))
    .reduce((sum, d) => sum + (d.value ?? 0), 0)
  const won = deals
    .filter(d => wonStageIds.has(d.stageId))
    .reduce((sum, d) => sum + (d.value ?? 0), 0)
  const open = deals.filter(d => !wonStageIds.has(d.stageId) && !lostStageIds.has(d.stageId)).length

  function fmt(v: number) {
    try {
      const primary = deals.find(d => d.currency)?.currency ?? 'ZAR'
      return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: primary, maximumFractionDigits: 0 }).format(v)
    } catch {
      return v.toFixed(0)
    }
  }

  return (
    <div className="flex gap-4 flex-wrap">
      {[
        { label: 'Pipeline value', value: fmt(total), sub: 'excl. lost' },
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [pipelinesLoading, setPipelinesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')

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

  const filteredDeals = stageFilter === 'all' ? deals : deals.filter(d => d.stageId === stageFilter)

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

          {/* View toggle */}
          <div
            className="flex rounded-[var(--radius-btn)] overflow-hidden border"
            style={{ borderColor: 'var(--color-outline)' }}
          >
            {(['board', 'list'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-label capitalize transition-colors"
                style={
                  viewMode === mode
                    ? { background: 'var(--color-accent-v2)', color: '#000' }
                    : { background: 'transparent', color: 'var(--color-on-surface-variant)' }
                }
              >
                <span className="material-symbols-outlined text-[14px]">
                  {mode === 'board' ? 'view_kanban' : 'list'}
                </span>
                {mode}
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
                  {['Deal', 'Stage', 'Value', 'Contact'].map(h => (
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
                  return (
                    <tr
                      key={deal.id}
                      className="border-b transition-colors hover:bg-[var(--color-surface-container)]"
                      style={{ borderColor: 'var(--color-card-border)' }}
                    >
                      <td className="px-4 py-3 font-medium text-on-surface">{deal.title}</td>
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
                      <td className="px-4 py-3">
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
    </div>
  )
}

// Helper: fallback color by stage kind when no custom color is set
function stageColorByKind(kind?: string): string {
  if (kind === 'won')  return '#4ade80'
  if (kind === 'lost') return '#ef4444'
  return '#60a5fa' // open stages default to blue
}
