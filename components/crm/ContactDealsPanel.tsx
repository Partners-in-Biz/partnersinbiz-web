'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Deal } from '@/lib/crm/types'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'

function fmtCloseDate(ts: unknown): string {
  if (!ts || typeof ts !== 'object') return ''
  const s = (ts as Record<string, unknown>)._seconds
  if (typeof s !== 'number') return ''
  return new Date(s * 1000).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function fmtValue(deal: Deal): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: deal.currency ?? 'ZAR',
      maximumFractionDigits: 2,
    }).format(deal.value ?? 0)
  } catch {
    return `${deal.currency ?? ''} ${(deal.value ?? 0).toFixed(2)}`
  }
}

/** Resolve stage label + chip color for a deal, given a map of pipelines. */
function resolveStage(
  deal: Deal,
  pipelinesById: Map<string, Pipeline>,
): { label: string; color: string } {
  const pipeline = pipelinesById.get(deal.pipelineId)
  const stage: PipelineStage | undefined = pipeline?.stages.find(s => s.id === deal.stageId)
  if (!stage) {
    // Fallback: raw stageId string, neutral color
    return { label: deal.stageId ?? '—', color: '#6b7280' }
  }
  const color = stage.color ?? kindColor(stage.kind)
  return { label: stage.label, color }
}

function kindColor(kind: string): string {
  if (kind === 'won')  return '#4ade80'
  if (kind === 'lost') return '#ef4444'
  return '#60a5fa'
}

interface Props {
  contactId: string
}

export function ContactDealsPanel({ contactId }: Props) {
  const [deals, setDeals] = useState<Deal[]>([])
  const [pipelinesById, setPipelinesById] = useState<Map<string, Pipeline>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!contactId) return
    let cancelled = false

    // Fetch deals and pipelines in parallel
    Promise.all([
      fetch(`/api/v1/crm/deals?contactId=${encodeURIComponent(contactId)}&limit=100`).then(r => r.json()),
      fetch('/api/v1/crm/pipelines').then(r => r.json()),
    ])
      .then(([dealsBody, pipelinesBody]) => {
        if (cancelled) return

        const raw: Deal[] = dealsBody.data ?? []
        const sorted = [...raw].sort((a, b) => {
          const aTs = (a.updatedAt as Record<string, number> | null)?._seconds ?? 0
          const bTs = (b.updatedAt as Record<string, number> | null)?._seconds ?? 0
          return bTs - aTs
        })
        setDeals(sorted)

        const pipelines: Pipeline[] = pipelinesBody.data ?? []
        const byId = new Map(pipelines.map((p: Pipeline) => [p.id, p]))
        setPipelinesById(byId)

        setLoading(false)
      })
      .catch(() => setLoading(false))

    return () => { cancelled = true }
  }, [contactId])

  return (
    <div className="pib-card-section">
      <div className="px-5 py-3.5 border-b border-[var(--color-pib-line)] bg-white/[0.02] flex items-center justify-between">
        <p className="eyebrow !text-[10px]">Deals</p>
        <span className="text-[11px] text-[var(--color-pib-text-muted)] font-mono">
          {loading ? '…' : `${deals.length} record${deals.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {loading ? (
        <div className="p-5 space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="pib-skeleton h-12" />
          ))}
        </div>
      ) : deals.length === 0 ? (
        <div className="p-10 text-center">
          <span className="material-symbols-outlined text-3xl text-[var(--color-pib-text-muted)]">
            monetization_on
          </span>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-2">
            No deals linked to this contact yet.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-pib-line)]">
          {deals.map((deal) => {
            const closeDate = fmtCloseDate(deal.expectedCloseDate)
            const { label: stageLabel, color: stageColor } = resolveStage(deal, pipelinesById)
            return (
              <div key={deal.id} className="px-5 py-3 flex items-center gap-4">
                <span
                  className="material-symbols-outlined text-[18px] shrink-0 text-[var(--color-pib-text-muted)]"
                >
                  monetization_on
                </span>
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/portal/deals?focus=${deal.id}`}
                    className="text-sm font-medium text-[var(--color-pib-text)] hover:underline truncate block"
                  >
                    {deal.title}
                  </Link>
                  <p className="text-[11px] text-[var(--color-pib-text-muted)] font-mono mt-0.5">
                    {fmtValue(deal)}
                    {closeDate ? ` · Close ${closeDate}` : ''}
                  </p>
                </div>
                <span
                  className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0"
                  style={{
                    background: `${stageColor}20`,
                    color: stageColor,
                  }}
                >
                  {stageLabel}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
