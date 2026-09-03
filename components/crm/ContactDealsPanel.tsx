'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Deal } from '@/lib/crm/types'
import { extractPipelinesList } from '@/lib/pipelines/response'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { DealDrawer } from './DealDrawer'
import { Icon } from '@/components/studio'

function fmtCloseDate(ts: unknown): string {
  if (!ts) return ''
  if (typeof ts !== 'object') return 'Close date needs review'
  const s = (ts as Record<string, unknown>)._seconds
  if (typeof s !== 'number') return '_seconds' in ts ? 'Close date needs review' : ''
  const date = new Date(s * 1000)
  if (Number.isNaN(date.getTime())) return 'Close date needs review'
  return date.toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function closeDateReadinessLabel(ts: unknown): string {
  const closeDate = fmtCloseDate(ts)
  if (closeDate === 'Close date needs review') return closeDate
  return closeDate ? `Close ${closeDate}` : 'Close date missing'
}

function dealTitleLabel(deal: Deal): string {
  return deal.title?.trim() || 'Deal name missing'
}

function fmtValue(deal: Deal): string {
  if (deal.value == null || Number.isNaN(deal.value)) return 'No value captured'
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: deal.currency ?? 'ZAR',
      maximumFractionDigits: 2,
    }).format(deal.value)
  } catch {
    return `${deal.currency ?? ''} ${deal.value.toFixed(2)}`
  }
}

function fmtMoney(value: number, currency = 'ZAR'): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(0)}`
  }
}

/** Resolve stage label + chip color for a deal, given a map of pipelines. */
function resolveStage(
  deal: Deal,
  pipelinesById: Map<string, Pipeline>,
): { label: string; color: string; kind: string } {
  const pipeline = pipelinesById.get(deal.pipelineId)
  const stage: PipelineStage | undefined = pipeline?.stages.find(s => s.id === deal.stageId)
  if (!stage) {
    return { label: fallbackStageLabel(deal.stageId), color: 'var(--color-pib-text-muted)', kind: fallbackStageKind(deal) }
  }
  const color = stage.color ?? kindColor(stage.kind)
  return { label: stage.label, color, kind: stage.kind }
}

function fallbackStageLabel(stageId?: string): string {
  const normalized = stageId?.trim()
  if (!normalized) return 'Stage not set'

  return normalized
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function fallbackStageKind(deal: Deal): string {
  if (deal.lostReason || deal.stageId === 'lost') return 'lost'
  if (deal.stageId === 'won') return 'won'
  return 'open'
}

function kindColor(kind: string): string {
  if (kind === 'won') return 'var(--color-accent-v2)'
  if (kind === 'lost') return 'var(--color-error)'
  return 'var(--color-primary)'
}

function unwrapDealsList(body: unknown): Deal[] {
  const response = body as { data?: Deal[] | { deals?: Deal[] }; deals?: Deal[] }
  if (Array.isArray(response.data)) return response.data
  if (response.data && !Array.isArray(response.data) && Array.isArray(response.data.deals)) return response.data.deals
  if (Array.isArray(response.deals)) return response.deals
  return []
}

function unwrapDeal(body: unknown): Deal | undefined {
  const response = body as { data?: Deal | { deal?: Deal }; deal?: Deal }
  if (response.data && 'deal' in response.data) return response.data.deal
  if (response.data && 'id' in response.data) return response.data as Deal
  return response.deal
}

interface Props {
  contactId: string
  contactName?: string
  orgId?: string
  orgScope?: PortalOrgRouteScope
}

export function ContactDealsPanel({ contactId, contactName, orgId = '', orgScope }: Props) {
  const [deals, setDeals] = useState<Deal[]>([])
  const [pipelinesById, setPipelinesById] = useState<Map<string, Pipeline>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [showDealDrawer, setShowDealDrawer] = useState(false)
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
  const contactLabel = contactName?.trim() || 'this contact'
  const opportunityHeadline = `Start ${contactLabel}'s first opportunity.`
  const panelScope = orgScope ?? { orgId }
  const scopedOrgId = panelScope.orgId ?? panelScope.id ?? orgId
  const dealsEndpoint = scopedApiPath(`/api/v1/crm/deals?contactId=${encodeURIComponent(contactId)}&limit=100`, panelScope)
  const pipelinesEndpoint = scopedApiPath('/api/v1/crm/pipelines', panelScope)
  const dealDetailEndpoint = (dealId: string) => scopedApiPath(`/api/v1/crm/deals/${dealId}`, panelScope)
  const dealHref = (dealId: string) => scopedPortalPath(`/portal/deals/${dealId}`, panelScope)
  const dealStats = deals.reduce(
    (stats, deal) => {
      const { kind } = resolveStage(deal, pipelinesById)
      const hasValue = deal.value !== null && deal.value !== undefined && !Number.isNaN(deal.value)
      const value = hasValue ? deal.value : 0
      if (hasValue) {
        stats.priced += 1
        stats.totalValue += value
      } else {
        stats.unpriced += 1
      }
      if (kind === 'won') {
        stats.won += 1
      } else if (kind === 'lost') {
        stats.lost += 1
      } else {
        stats.open += 1
        if (hasValue) stats.weightedValue += value * ((deal.probability ?? 0) / 100)
      }
      return stats
    },
    { open: 0, won: 0, lost: 0, priced: 0, unpriced: 0, totalValue: 0, weightedValue: 0 },
  )
  const primaryCurrency = deals.find((deal) => deal.currency)?.currency ?? 'ZAR'

  useEffect(() => {
    if (!contactId) return
    let cancelled = false

    // Fetch deals and pipelines in parallel
    Promise.all([
      fetch(dealsEndpoint).then(r => r.json()),
      fetch(pipelinesEndpoint).then(r => r.json()),
    ])
      .then(([dealsBody, pipelinesBody]) => {
        if (cancelled) return

        const raw = unwrapDealsList(dealsBody)
        const sorted = [...raw].sort((a, b) => {
          const aTs = (a.updatedAt as Record<string, number> | null)?._seconds ?? 0
          const bTs = (b.updatedAt as Record<string, number> | null)?._seconds ?? 0
          return bTs - aTs
        })
        setDeals(sorted)

        const pipelines = extractPipelinesList(pipelinesBody)
        const byId = new Map(pipelines.map((p: Pipeline) => [p.id, p]))
        setPipelinesById(byId)

        setLoading(false)
        setLoadError(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoadError(true)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [contactId, reloadToken, dealsEndpoint, pipelinesEndpoint])

  function openNewDealDrawer() {
    setSelectedDeal(null)
    setShowDealDrawer(true)
  }

  function openDealEditor(deal: Deal) {
    setSelectedDeal(deal)
    setShowDealDrawer(true)
  }

  return (
    <div className="overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
      <div className="flex h-9 items-center justify-between border-b border-[var(--color-card-border)] bg-black/[0.08] px-3">
        <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Deals</p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-[var(--color-pib-text-muted)]">
            {loading ? '…' : `${deals.length} record${deals.length === 1 ? '' : 's'}`}
          </span>
          <button
            type="button"
            aria-label={`New deal for ${contactLabel}`}
            onClick={openNewDealDrawer}
            className="flex h-7 items-center gap-1 rounded-md border border-[var(--color-card-border)] px-2 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          >
            <Icon name="add" className="text-[14px]" />
            New deal
          </button>
        </div>
      </div>

      {!loading && deals.length > 0 && (
        <div className="border-b border-[var(--color-card-border)] px-3 py-2">
          <p className="text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Relationship pipeline</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
              <p className="text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">Open deals</p>
              <p className="mt-1 text-lg font-medium text-[var(--color-pib-text)]">{dealStats.open}</p>
              <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">{dealStats.won} won / {dealStats.lost} lost</p>
            </div>
            <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
              <p className="text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">Total value</p>
              <p className="mt-1 text-lg font-medium text-[var(--color-pib-text)]">
                {dealStats.priced > 0 ? fmtMoney(dealStats.totalValue, primaryCurrency) : 'No priced deals'}
              </p>
              <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
                {dealStats.priced > 0
                  ? `${dealStats.unpriced} unpriced ${dealStats.unpriced === 1 ? 'deal' : 'deals'}`
                  : 'Capture deal value to unlock linked pipeline totals'}
              </p>
            </div>
            <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
              <p className="text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">Weighted value</p>
              <p className="mt-1 text-lg font-medium text-[var(--color-pib-text)]">
                {dealStats.priced > 0 ? fmtMoney(dealStats.weightedValue, primaryCurrency) : 'Forecast value needed'}
              </p>
              <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
                {dealStats.priced > 0 ? 'open probability forecast' : 'Price at least one open deal to forecast this contact'}
              </p>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2 p-3" role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
            <Icon name="progress_activity" className="text-[16px] text-[var(--color-accent-v2)]" />
            <span>Loading relationship pipeline for {contactLabel}...</span>
          </div>
          {[...Array(2)].map((_, i) => (
            <div key={i} className="pib-skeleton h-10 rounded-md" />
          ))}
        </div>
      ) : loadError ? (
        <div className="p-3 text-center">
          <Icon name="sync_problem" className="text-[19px] text-[var(--st-warning)]" />
          <p className="mt-2 text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Relationship pipeline</p>
          <h3 className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">
            Deal pipeline unavailable
          </h3>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[var(--color-pib-text-muted)]">
            We could not load linked deals for {contactLabel}. Retry before treating this relationship as having no open opportunity.
          </p>
          <button
            type="button"
            aria-label={`Retry linked deals for ${contactLabel}`}
            onClick={() => {
              setLoading(true)
              setLoadError(false)
              setReloadToken((value) => value + 1)
            }}
            className="mx-auto mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          >
            <Icon name="refresh" className="text-[14px]" />
            Retry linked deals
          </button>
        </div>
      ) : deals.length === 0 ? (
        <div className="p-3 text-center">
          <Icon name="monetization_on" className="text-[19px] text-[var(--color-accent-v2)]" />
          <p className="mt-2 text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Relationship pipeline</p>
          <h3 className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">
            {opportunityHeadline}
          </h3>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[var(--color-pib-text-muted)]">
            Create a deal from this contact so pipeline value, quotes, close dates, and next steps stay connected to the relationship.
          </p>
          <div className="mx-auto mt-3 grid max-w-lg gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2 text-left">
              <p className="text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">Contact anchored</p>
              <p className="mt-1 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">The new deal opens with this relationship already attached.</p>
            </div>
            <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2 text-left">
              <p className="text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">Forecast ready</p>
              <p className="mt-1 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">Capture value, probability, close date, and stage in one pass.</p>
            </div>
          </div>
          <button
            type="button"
            aria-label={`Create first deal for ${contactLabel}`}
            onClick={openNewDealDrawer}
            className="mx-auto mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          >
            <Icon name="add" className="text-[14px]" />
            Create first deal
          </button>
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-card-border)]">
          {deals.map((deal) => {
            const closeDateLabel = closeDateReadinessLabel(deal.expectedCloseDate)
            const titleLabel = dealTitleLabel(deal)
            const { label: stageLabel, color: stageColor } = resolveStage(deal, pipelinesById)
            const hasValue = deal.value !== null && deal.value !== undefined && !Number.isNaN(deal.value)
            const closeDateAction = closeDateLabel === 'Close date missing' ? 'Add close date' : 'Edit close date'
            return (
              <div key={deal.id} className="flex items-center gap-3 px-3 py-2 transition hover:bg-white/[0.04]">
                <span className="shrink-0" aria-hidden="true">
                  <Icon name="monetization_on" className="text-[16px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={dealHref(deal.id)}
                    className="block truncate text-sm font-medium text-[var(--color-pib-text)] hover:underline"
                  >
                    {titleLabel}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
                    <button
                      type="button"
                      onClick={() => openDealEditor(deal)}
                      aria-label={`${hasValue ? 'Edit' : 'Add'} value for ${titleLabel} from contact deal row`}
                      className="text-[var(--color-pib-text-muted)] transition hover:text-primary"
                    >
                      {fmtValue(deal)}
                    </button>
                    <span className="text-[var(--color-pib-text-muted)]" aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => openDealEditor(deal)}
                      aria-label={`${closeDateAction} for ${titleLabel} from contact deal row`}
                      className="text-[var(--color-pib-text-muted)] transition hover:text-primary"
                    >
                      {closeDateLabel}
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openDealEditor(deal)}
                  aria-label={`Edit stage for ${titleLabel} from contact deal row`}
                  className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-label uppercase tracking-wide transition-opacity hover:opacity-80"
                  style={{
                    background: `${stageColor}20`,
                    color: stageColor,
                  }}
                >
                  {stageLabel}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {showDealDrawer && (
        <DealDrawer
          deal={selectedDeal ?? undefined}
          defaultContactId={contactId}
          defaultContactLabel={contactName}
          orgId={scopedOrgId}
          orgScope={panelScope}
          onSaved={(dealId) => {
            setShowDealDrawer(false)
            const editedDealId = selectedDeal?.id
            setSelectedDeal(null)
            // Fetch the saved deal and keep the contact-linked list current.
            fetch(dealDetailEndpoint(dealId))
              .then(r => r.json())
              .then(b => {
                const newDeal = unwrapDeal(b)
                if (newDeal) {
                  setDeals(prev => editedDealId
                    ? prev.map((deal) => deal.id === editedDealId ? newDeal : deal)
                    : [newDeal, ...prev],
                  )
                }
              })
              .catch(() => {
                // Fallback: reload all deals for this contact
                fetch(dealsEndpoint)
                  .then(r => r.json())
                  .then(b => setDeals(unwrapDealsList(b)))
                  .catch(() => undefined)
              })
          }}
          onClose={() => {
            setSelectedDeal(null)
            setShowDealDrawer(false)
          }}
        />
      )}
    </div>
  )
}
