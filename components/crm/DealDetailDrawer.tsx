'use client'

/**
 * DealDetailDrawer — read-only deal detail panel
 *
 * A5: shows probability badge + weighted value, lost reason, and line items.
 * A5 final: "Convert to quote" button pre-fills lineItems from the deal.
 */

import { useState } from 'react'
import type { Deal, Currency } from '@/lib/crm/types'
import type { PipelineStage } from '@/lib/pipelines/types'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { DealLineItemsEditor } from './DealLineItemsEditor'

export interface DealDetailDrawerProps {
  deal: Deal
  stages: PipelineStage[]
  orgId: string
  orgScope?: PortalOrgRouteScope
  onClose: () => void
  onEdit?: () => void
  contactLabel?: string
  contactBasePath?: string
  companyBasePath?: string
  contactHrefForDeal?: (deal: Deal) => string
  companyHrefForDeal?: (deal: Deal) => string
}

function fmtValue(value: number, currency: Currency): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

function isLostStage(stage?: PipelineStage): boolean {
  if (!stage) return false
  return stage.kind === 'lost' || stage.label.toLowerCase().includes('lost')
}

function fmtDate(value: unknown): string {
  if (!value) return 'No close date'
  const seconds = typeof value === 'object' && value !== null && 'seconds' in value
    ? Number((value as { seconds: number }).seconds) * 1000
    : null
  const date = seconds ? new Date(seconds) : new Date(value as string | number | Date)
  if (Number.isNaN(date.getTime())) return 'Close date needs review'
  return date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function dealOwnerLabel(deal: Deal): string {
  if (deal.ownerRef?.displayName) return deal.ownerRef.displayName
  if (deal.ownerRef?.uid || deal.ownerUid) return 'Deal owner identity missing'
  return 'Unassigned'
}

export function DealDetailDrawer({
  deal,
  stages,
  orgId,
  orgScope,
  onClose,
  onEdit,
  contactLabel,
  contactBasePath = '/portal/contacts',
  companyBasePath = '/portal/companies',
  contactHrefForDeal,
  companyHrefForDeal,
}: DealDetailDrawerProps) {
  const stage = stages.find(s => s.id === deal.stageId)
  const stageColor = stage?.color ?? (stage?.kind === 'won' ? '#4ade80' : stage?.kind === 'lost' ? '#ef4444' : '#60a5fa')
  const showLostReason = isLostStage(stage)
  const dealLabel = deal.title?.trim() || 'Deal name missing'
  const readableContact = contactLabel?.trim() || 'Decision-maker name missing'
  const readableCompany = deal.companyName?.trim() || (deal.companyId ? 'Company name missing' : '')
  const contactHref = contactHrefForDeal ? contactHrefForDeal(deal) : `${contactBasePath}/${deal.contactId}`
  const companyHref = companyHrefForDeal ? companyHrefForDeal(deal) : `${companyBasePath}/${deal.companyId}`
  const quoteCreatePath = scopedApiPath('/api/v1/quotes', orgScope ?? { orgId })
  const quotesHref = scopedPortalPath('/portal/quotes', orgScope ?? { orgId })
  const ownerLabel = dealOwnerLabel(deal)
  const needsOwner = !deal.ownerRef?.displayName && !deal.ownerRef?.uid && !deal.ownerUid
  const closeDateLabel = fmtDate(deal.expectedCloseDate)
  const closeDateState = closeDateLabel === 'No close date'
    ? 'missing'
    : closeDateLabel === 'Close date needs review'
      ? 'invalid'
      : 'ready'
  const needsCloseDate = closeDateState !== 'ready'
  const closeDateActionLabel = closeDateState === 'invalid' ? 'Review close date' : 'Set close date'
  const closeDateActionHeading = closeDateState === 'invalid' ? 'Review forecast timing' : 'Set forecast timing'
  const closeDateActionDescription = closeDateState === 'invalid'
    ? 'This deal has a saved close date that cannot be read. Re-enter the expected close date so leadership can trust forecast timing.'
    : 'No expected close date is captured. Add one so leadership can trust forecast timing, stale-deal reviews, and pipeline commitments.'

  const probability = deal.probability ?? (stage?.probability ?? 100)
  const hasDealValue = deal.value !== null && deal.value !== undefined
  const dealValueLabel = hasDealValue ? fmtValue(deal.value, deal.currency) : 'No value captured'
  const weightedValue = hasDealValue ? deal.value * (probability / 100) : null

  const labelCls = 'block text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant mb-1'

  // Convert to quote state
  const [convertingQuote, setConvertingQuote] = useState(false)
  const [quoteResult, setQuoteResult] = useState<{ quoteNumber: string; id: string } | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  async function handleConvertToQuote() {
    setConvertingQuote(true)
    setQuoteError(null)
    setQuoteResult(null)
    try {
      const res = await fetch(quoteCreatePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: deal.id }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Failed to create quote')
      }
      const data = json.data ?? json
      setQuoteResult({ quoteNumber: data.quoteNumber, id: data.id })
    } catch (e: unknown) {
      setQuoteError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setConvertingQuote(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Deal details"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div
        className="relative z-50 h-full w-full max-w-lg flex flex-col overflow-hidden border-l border-[var(--color-card-border)] bg-[var(--color-card)]"
      >
        {/* Header */}
        <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-card-border)] px-4 py-2">
          <div className="flex items-center gap-3 min-w-0">
            <p className="text-sm font-semibold text-on-surface truncate">{dealLabel}</p>
            {stage && (
              <span
                className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0"
                style={{ background: `${stageColor}20`, color: stageColor }}
              >
                {stage.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Convert to quote */}
            <button
              type="button"
              onClick={handleConvertToQuote}
              disabled={convertingQuote}
              className="cursor-pointer inline-flex h-7 items-center rounded-md border border-[var(--color-card-border)] px-2 text-[10px] font-label uppercase tracking-wide text-on-surface-variant transition-colors hover:bg-white/[0.05] hover:text-on-surface disabled:opacity-50 disabled:cursor-not-allowed"
              title="Convert to quote"
            >
              {convertingQuote ? 'Creating…' : 'Quote'}
            </button>
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="cursor-pointer flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-white/[0.05] hover:text-on-surface"
                title="Edit deal"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-white/[0.05] hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Quote conversion feedback */}
          {quoteResult && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
              <span className="material-symbols-outlined text-[15px]">check_circle</span>
              <span>
                Quote {quoteResult.quoteNumber} created — view in{' '}
                <a
                  href={quotesHref}
                  className="underline font-semibold"
                  onClick={onClose}
                >
                  Quotes
                </a>
              </span>
            </div>
          )}
          {quoteError && (
            <div className="flex items-center gap-2 rounded-md border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-100">
              <span className="material-symbols-outlined text-[15px]">error</span>
              <span>{quoteError}</span>
            </div>
          )}
          {/* Value + weighted value */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <p className={labelCls}>Deal value</p>
              {onEdit ? (
                <button
                  type="button"
                  aria-label={`${hasDealValue ? 'Edit' : 'Add'} value for ${dealLabel} from deal detail`}
                  onClick={onEdit}
                  className="text-left text-lg font-semibold text-on-surface transition-colors hover:text-[var(--color-accent-text)]"
                >
                  {dealValueLabel}
                </button>
              ) : (
                <p className="text-lg font-semibold text-on-surface">
                  {dealValueLabel}
                </p>
              )}
            </div>
            <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
              <p className={labelCls}>Weighted</p>
              <p className="text-sm font-mono font-semibold text-on-surface">
                {weightedValue === null ? 'Value needed' : fmtValue(weightedValue, deal.currency)}
              </p>
            </div>
          </div>

          {/* Probability */}
          <div>
            <p className={labelCls}>Probability</p>
            <div className="flex items-center gap-3">
              {/* Progress bar */}
              <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${probability}%`,
                    background: probability >= 70 ? '#4ade80' : probability >= 40 ? '#facc15' : '#f87171',
                  }}
                />
              </div>
              <span
                className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background: probability >= 70 ? '#4ade8020' : probability >= 40 ? '#facc1520' : '#f8717120',
                  color: probability >= 70 ? '#4ade80' : probability >= 40 ? '#facc15' : '#f87171',
                }}
              >
                {probability}%
              </span>
            </div>
          </div>

          {/* Lost reason */}
          {showLostReason && deal.lostReason && (
            <div>
              <p className={labelCls}>Lost reason</p>
              <p className="text-xs leading-5 text-on-surface-variant whitespace-pre-wrap rounded-md px-3 py-2 bg-white/[0.03] border border-[var(--color-card-border)]">
                {deal.lostReason}
              </p>
            </div>
          )}

          {/* Notes */}
          {deal.notes && (
            <div>
              <p className={labelCls}>Notes</p>
              <p className="text-xs leading-5 text-on-surface whitespace-pre-wrap">{deal.notes}</p>
            </div>
          )}

          <div
            className="rounded-md border border-[var(--color-card-border)] bg-white/[0.02] p-3"
            aria-label="Relationship context"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={labelCls}>Relationship context</p>
                <p className="text-xs leading-5 text-on-surface-variant">
                  People, account, owner, and timing signals for this opportunity.
                </p>
              </div>
              <span
                className="material-symbols-outlined text-[16px]"
                style={{ color: stageColor }}
                aria-hidden="true"
              >
                hub
              </span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
                <p className={labelCls}>Contact</p>
                {deal.contactId ? (
                  <a
                    href={contactHref}
                    className="text-xs font-semibold text-[var(--color-accent-text)] hover:underline"
                  >
                    {readableContact}
                  </a>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-on-surface-variant">No decision-maker linked</p>
                    {onEdit ? (
                      <button
                        type="button"
                        aria-label={`Link decision-maker for ${dealLabel}`}
                        onClick={onEdit}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] font-medium text-[var(--color-accent-text)] transition-colors hover:bg-white/[0.05] hover:text-on-surface"
                      >
                        <span className="material-symbols-outlined text-[13px]" aria-hidden="true">person_add</span>
                        Link decision-maker
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
                <p className={labelCls}>Company</p>
                {deal.companyId ? (
                  <a
                    href={companyHref}
                    className="text-xs font-semibold text-[var(--color-accent-text)] hover:underline"
                  >
                    {readableCompany}
                  </a>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-on-surface-variant">{readableCompany || 'No company linked'}</p>
                    {onEdit ? (
                      <button
                        type="button"
                        aria-label={`Link company for ${dealLabel}`}
                        onClick={onEdit}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] font-medium text-[var(--color-accent-text)] transition-colors hover:bg-white/[0.05] hover:text-on-surface"
                      >
                        <span className="material-symbols-outlined text-[13px]" aria-hidden="true">add_business</span>
                        Link company
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
                <p className={labelCls}>Owner</p>
                {needsOwner ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-label uppercase tracking-[0.18em] text-on-surface-variant">
                      Deal owner missing
                    </p>
                    <h3 className="text-xs font-semibold text-on-surface">Assign forecast ownership</h3>
                    <p className="text-xs leading-5 text-on-surface-variant">
                      No team member owns this opportunity. Assign an owner so follow-up, forecast review, and handoff accountability are visible before the deal stalls.
                    </p>
                    {onEdit ? (
                      <button
                        type="button"
                        aria-label={`Assign owner for ${dealLabel}`}
                        onClick={onEdit}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
                      >
                        <span className="material-symbols-outlined text-[13px]" aria-hidden="true">person_add</span>
                        Assign owner
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs font-semibold text-on-surface">{ownerLabel}</p>
                )}
              </div>
              <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
                <p className={labelCls}>Close date</p>
                {needsCloseDate ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-label uppercase tracking-[0.18em] text-on-surface-variant">
                      {closeDateLabel === 'No close date' ? 'Close date missing' : closeDateLabel}
                    </p>
                    <h3 className="text-xs font-semibold text-on-surface">{closeDateActionHeading}</h3>
                    <p className="text-xs leading-5 text-on-surface-variant">
                      {closeDateActionDescription}
                    </p>
                    {onEdit ? (
                      <button
                        type="button"
                        aria-label={`${closeDateActionLabel} for ${dealLabel}`}
                        onClick={onEdit}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
                      >
                        <span className="material-symbols-outlined text-[13px]" aria-hidden="true">event_upcoming</span>
                        {closeDateActionLabel}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs font-semibold text-on-surface">{closeDateLabel}</p>
                )}
              </div>
            </div>
          </div>

          {/* Line items */}
          <div>
            <p className={labelCls}>Line Items</p>
            <DealLineItemsEditor
              value={deal.lineItems ?? []}
              onChange={() => {}} // no-op in read-only
              currency={deal.currency}
              orgId={orgId}
              orgScope={orgScope}
              readOnly
            />
          </div>
        </div>
      </div>
    </div>
  )
}
