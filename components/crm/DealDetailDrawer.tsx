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

  const labelCls = 'block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1'

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
        className="relative z-50 h-full w-full max-w-lg flex flex-col overflow-hidden"
        style={{ background: 'var(--color-pib-surface)', borderLeft: '1px solid var(--color-pib-line)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--color-pib-line)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <p className="text-sm font-semibold text-[var(--color-pib-text)] truncate">{dealLabel}</p>
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
              className="cursor-pointer text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:border-[var(--color-pib-text-muted)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Convert to quote"
            >
              {convertingQuote ? 'Creating…' : 'Quote'}
            </button>
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
                title="Edit deal"
              >
                <span className="material-symbols-outlined text-[18px]">edit</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Quote conversion feedback */}
          {quoteResult && (
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              style={{ background: '#4ade8020', border: '1px solid #4ade8040', color: '#4ade80' }}
            >
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
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
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              style={{ background: '#f8717120', border: '1px solid #f8717140', color: '#f87171' }}
            >
              <span className="material-symbols-outlined text-[16px]">error</span>
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
                  className="text-left text-xl font-headline font-bold text-[var(--color-pib-text)] transition-colors hover:text-[var(--color-pib-accent)]"
                >
                  {dealValueLabel}
                </button>
              ) : (
                <p className="text-xl font-headline font-bold text-[var(--color-pib-text)]">
                  {dealValueLabel}
                </p>
              )}
            </div>
            <div
              className="px-3 py-2 rounded-lg"
              style={{ background: 'var(--color-surface-container)' }}
            >
              <p className={labelCls}>Weighted</p>
              <p className="text-sm font-mono font-semibold text-[var(--color-pib-text)]">
                {weightedValue === null ? 'Value needed' : fmtValue(weightedValue, deal.currency)}
              </p>
            </div>
          </div>

          {/* Probability */}
          <div>
            <p className={labelCls}>Probability</p>
            <div className="flex items-center gap-3">
              {/* Progress bar */}
              <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${probability}%`,
                    background: probability >= 70 ? '#4ade80' : probability >= 40 ? '#facc15' : '#f87171',
                  }}
                />
              </div>
              <span
                className="text-sm font-mono font-semibold px-2 py-0.5 rounded-full"
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
              <p className="text-sm text-[var(--color-pib-text-muted)] whitespace-pre-wrap rounded-lg px-3 py-2 bg-white/[0.03] border border-[var(--color-pib-line)]">
                {deal.lostReason}
              </p>
            </div>
          )}

          {/* Notes */}
          {deal.notes && (
            <div>
              <p className={labelCls}>Notes</p>
              <p className="text-sm text-[var(--color-pib-text)] whitespace-pre-wrap">{deal.notes}</p>
            </div>
          )}

          <div
            className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4"
            aria-label="Relationship context"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={labelCls}>Relationship context</p>
                <p className="text-sm text-[var(--color-pib-text-muted)]">
                  People, account, owner, and timing signals for this opportunity.
                </p>
              </div>
              <span
                className="material-symbols-outlined text-[18px]"
                style={{ color: stageColor }}
                aria-hidden="true"
              >
                hub
              </span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-md bg-black/10 px-3 py-2">
                <p className={labelCls}>Contact</p>
                {deal.contactId ? (
                  <a
                    href={contactHref}
                    className="text-sm font-semibold text-[var(--color-pib-accent)] hover:underline"
                  >
                    {readableContact}
                  </a>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-[var(--color-pib-text-muted)]">No decision-maker linked</p>
                    {onEdit ? (
                      <button
                        type="button"
                        aria-label={`Link decision-maker for ${dealLabel}`}
                        onClick={onEdit}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-[11px] font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
                      >
                        <span className="material-symbols-outlined text-[13px]" aria-hidden="true">person_add</span>
                        Link decision-maker
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="rounded-md bg-black/10 px-3 py-2">
                <p className={labelCls}>Company</p>
                {deal.companyId ? (
                  <a
                    href={companyHref}
                    className="text-sm font-semibold text-[var(--color-pib-accent)] hover:underline"
                  >
                    {readableCompany}
                  </a>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-[var(--color-pib-text-muted)]">{readableCompany || 'No company linked'}</p>
                    {onEdit ? (
                      <button
                        type="button"
                        aria-label={`Link company for ${dealLabel}`}
                        onClick={onEdit}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-[11px] font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
                      >
                        <span className="material-symbols-outlined text-[13px]" aria-hidden="true">add_business</span>
                        Link company
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="rounded-md bg-black/10 px-3 py-2">
                <p className={labelCls}>Owner</p>
                {needsOwner ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      Deal owner missing
                    </p>
                    <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Assign forecast ownership</h3>
                    <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">
                      No team member owns this opportunity. Assign an owner so follow-up, forecast review, and handoff accountability are visible before the deal stalls.
                    </p>
                    {onEdit ? (
                      <button
                        type="button"
                        aria-label={`Assign owner for ${dealLabel}`}
                        onClick={onEdit}
                        className="btn-pib-secondary inline-flex items-center gap-1.5 text-xs"
                      >
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">person_add</span>
                        Assign owner
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-[var(--color-pib-text)]">{ownerLabel}</p>
                )}
              </div>
              <div className="rounded-md bg-black/10 px-3 py-2">
                <p className={labelCls}>Close date</p>
                {needsCloseDate ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      {closeDateLabel === 'No close date' ? 'Close date missing' : closeDateLabel}
                    </p>
                    <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">{closeDateActionHeading}</h3>
                    <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">
                      {closeDateActionDescription}
                    </p>
                    {onEdit ? (
                      <button
                        type="button"
                        aria-label={`${closeDateActionLabel} for ${dealLabel}`}
                        onClick={onEdit}
                        className="btn-pib-secondary inline-flex items-center gap-1.5 text-xs"
                      >
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">event_upcoming</span>
                        {closeDateActionLabel}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-[var(--color-pib-text)]">{closeDateLabel}</p>
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
              readOnly
            />
          </div>
        </div>
      </div>
    </div>
  )
}
