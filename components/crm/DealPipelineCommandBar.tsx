'use client'

import type { Deal } from '@/lib/crm/types'
import type { PipelineStage } from '@/lib/pipelines/types'

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
  const weightedPipeline = openDeals.reduce((sum, deal) => {
    const stage = stages.find((item) => item.id === deal.stageId)
    const probability = deal.probability ?? stage?.probability ?? 50
    return sum + (deal.value ?? 0) * (probability / 100)
  }, 0)
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
    <section className="pib-card-section overflow-hidden">
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow !text-[10px]">Deal command runway</p>
              <h2 className="mt-1 text-xl font-headline font-semibold text-on-surface">Pipeline lens and revenue risk</h2>
            </div>
            <div className="rounded-xl border border-[var(--color-pib-line)] bg-white/[0.03] px-4 py-3 text-right">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Weighted open value</p>
              <p className="mt-1 text-lg font-semibold text-on-surface">{formatMoney(weightedPipeline, primaryCurrency)}</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
                    'min-h-[72px] rounded-lg border px-3 py-2 text-left transition-colors',
                    active
                      ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent)]/10'
                      : 'border-[var(--color-pib-line)] bg-white/[0.02] hover:bg-white/[0.05]',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{button.label}</span>
                    <span className="material-symbols-outlined text-[17px] text-on-surface-variant">{button.icon}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-on-surface">{button.value}</p>
                </button>
              )
            })}
          </div>
        </div>

        <label className="block">
          <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Search deals</span>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] px-3 py-2">
            <span className="material-symbols-outlined text-[17px] text-on-surface-variant">search</span>
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              aria-label="Search deals"
              placeholder="Search title, company, contact, or id"
              className="min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant"
            />
          </div>
          <p className="mt-2 text-xs leading-5 text-on-surface-variant">
            Use this lens before editing stages, forecast probability, or opening a deal record.
          </p>
        </label>
      </div>
    </section>
  )
}
