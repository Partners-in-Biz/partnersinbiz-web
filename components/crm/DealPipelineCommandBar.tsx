'use client'

import type { Deal } from '@/lib/crm/types'
import type { PipelineStage } from '@/lib/pipelines/types'
import { Icon } from '@/components/studio'

export type DealFocusMode = 'all' | 'atRisk' | 'needsContact' | 'quoteReady' | 'noCloseDate'

interface DealPipelineCommandBarProps {
  deals: Deal[]
  stages: PipelineStage[]
  search: string
  focusMode: DealFocusMode
  onSearchChange: (value: string) => void
  onFocusModeChange: (mode: DealFocusMode) => void
}

function timestampMs(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value) || 0
  if (typeof value === 'object') {
    const timestamp = value as { seconds?: number; _seconds?: number; toDate?: () => Date; toMillis?: () => number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function formatMoney(value: number, currency: string) {
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

export function isDealAtRisk(deal: Deal, stages: PipelineStage[]) {
  const stage = stages.find((item) => item.id === deal.stageId)
  if (stage?.kind === 'lost') return false
  const expectedCloseMs = timestampMs(deal.expectedCloseDate)
  return Boolean(expectedCloseMs && expectedCloseMs < Date.now())
}

export function isDealQuoteReady(deal: Deal) {
  return (deal.lineItems?.length ?? 0) > 0
}

export function isDealMissingCloseDate(deal: Deal) {
  return !deal.expectedCloseDate
}

export function matchesDealFocus(deal: Deal, stages: PipelineStage[], focusMode: DealFocusMode) {
  if (focusMode === 'atRisk') return isDealAtRisk(deal, stages)
  if (focusMode === 'needsContact') return !deal.contactId
  if (focusMode === 'quoteReady') return isDealQuoteReady(deal)
  if (focusMode === 'noCloseDate') return isDealMissingCloseDate(deal)
  return true
}

export function DealPipelineCommandBar({
  deals,
  stages,
  search,
  focusMode,
  onSearchChange,
  onFocusModeChange,
}: DealPipelineCommandBarProps) {
  const lostStageIds = new Set(stages.filter((stage) => stage.kind === 'lost').map((stage) => stage.id))
  const primaryCurrency = deals.find((deal) => deal.currency)?.currency ?? 'ZAR'
  const openDeals = deals.filter((deal) => !lostStageIds.has(deal.stageId))
  const openPipeline = openDeals.reduce(
    (stats, deal) => {
      const stage = stages.find((item) => item.id === deal.stageId)
      const probability = deal.probability ?? stage?.probability ?? 50
      const hasValue = typeof deal.value === 'number' && Number.isFinite(deal.value)

      if (hasValue) {
        stats.priced += 1
        stats.weightedValue += deal.value * (probability / 100)
      } else {
        stats.unpriced += 1
      }

      return stats
    },
    { priced: 0, unpriced: 0, weightedValue: 0 },
  )
  const atRisk = deals.filter((deal) => isDealAtRisk(deal, stages)).length
  const missingContact = deals.filter((deal) => !deal.contactId).length
  const quoteReady = deals.filter(isDealQuoteReady).length
  const missingCloseDate = deals.filter(isDealMissingCloseDate).length

  const focusButtons: Array<{ mode: DealFocusMode; label: string; value: string; icon: string; ariaLabel: string }> = [
    { mode: 'all', label: 'All deals', value: String(deals.length), icon: 'select_all', ariaLabel: 'Focus all deals' },
    { mode: 'atRisk', label: 'Risky deals', value: `${atRisk} risky`, icon: 'warning', ariaLabel: 'Focus risky deals' },
    { mode: 'needsContact', label: 'Needs contact', value: `${missingContact} missing contact`, icon: 'person_alert', ariaLabel: 'Focus deals that need contacts' },
    { mode: 'quoteReady', label: 'Quote-ready', value: `${quoteReady} quote-ready`, icon: 'request_quote', ariaLabel: 'Focus quote-ready deals' },
    { mode: 'noCloseDate', label: 'Needs close date', value: `${missingCloseDate} missing date`, icon: 'edit_calendar', ariaLabel: 'Focus deals missing close dates' },
  ]

  return (
    <section className="overflow-hidden rounded-[var(--st-radius-raised)] border border-[var(--color-card-border)] bg-[var(--color-card)]/55 px-2 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <div className="flex min-w-0 items-center gap-2 pr-1">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]">Deal command runway</p>
            <h2 className="truncate text-xs leading-tight text-[var(--color-pib-text)]">Pipeline lens and revenue risk</h2>
          </div>
        </div>

        {focusButtons.map((button) => {
          const active = focusMode === button.mode
          return (
            <button
              key={button.mode}
              type="button"
              onClick={() => onFocusModeChange(button.mode)}
              aria-label={button.ariaLabel}
              aria-pressed={active}
              className={[
                'flex h-7 shrink-0 items-center gap-1.5 rounded border px-2.5 text-[11px] transition',
                active
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-[var(--color-card-border)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]',
              ].join(' ')}
            >
              <Icon name={button.icon} />
              <span className="font-label uppercase tracking-wide text-[10px]">{button.label}</span>
              <span>{button.value}</span>
            </button>
          )
        })}

        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">
          <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-1 text-right">
            <p className="text-[9px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Weighted open value</p>
            <p className="text-xs leading-4 text-[var(--color-pib-text)]">
              {openPipeline.priced > 0
                ? formatMoney(openPipeline.weightedValue, primaryCurrency)
                : openDeals.length > 0
                  ? 'Forecast value needed'
                  : 'No open deals'}
              <span className="ml-1.5 font-normal text-[10px] text-[var(--color-pib-text-muted)]">
                {openPipeline.unpriced > 0
                  ? `${openPipeline.unpriced} unpriced open ${openPipeline.unpriced === 1 ? 'deal' : 'deals'}`
                  : openDeals.length > 0
                    ? 'prob-adjusted forecast'
                    : 'pipeline is clear'}
              </span>
            </p>
          </div>

          <label className="block min-w-[200px]">
            <span className="sr-only">Search deals</span>
            <div className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] bg-transparent px-2">
              <Icon name="search" className="text-[var(--color-pib-text-muted)]" />
              <input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                aria-label="Search deals"
                placeholder="Search title, company, contact, or id"
                className="min-w-0 flex-1 bg-transparent text-xs text-[var(--color-pib-text)] outline-none placeholder:text-[var(--color-pib-text-muted)]"
              />
            </div>
          </label>
        </div>
        <p className="px-1 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
          Use this lens before editing stages, forecast probability, or opening a deal record.
        </p>
      </div>
    </section>
  )
}
