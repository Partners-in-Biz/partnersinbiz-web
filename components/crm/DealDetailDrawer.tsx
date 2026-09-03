'use client'

/**
 * DealDetailDrawer - read-only deal detail panel
 *
 * A5: shows probability badge + weighted value, lost reason, and line items.
 * A5 final: "Convert to quote" button pre-fills lineItems from the deal.
 */

import { useState } from 'react'
import type { Deal, Currency } from '@/lib/crm/types'
import type { PipelineStage } from '@/lib/pipelines/types'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { DealLineItemsEditor } from './DealLineItemsEditor'
import { ShareWithPartnerButton } from '@/components/crm/ShareWithPartnerButton'
import { Icon } from '@/components/studio'

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
  const stageColor = stage?.color ?? (stage?.kind === 'won' ? 'var(--color-accent-v2)' : stage?.kind === 'lost' ? 'var(--color-error)' : 'var(--color-primary)')
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

  const labelCls = 'block text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)] mb-1'

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
            <p className="text-sm text-[var(--color-pib-text)] truncate">{dealLabel}</p>
            {stage && (
              <span
                className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded shrink-0"
                style={{ background: `${stageColor}20`, color: stageColor }}
              >
                {stage.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ShareWithPartnerButton
              resourceType="deal"
              resourceId={deal.id}
              label="Share"
              orgScope={orgScope ?? { orgId }}
              className="btn-pib-secondary btn-pib-sm inline-flex items-center gap-1.5"
            />
            {/* Convert to quote */}
            <button
              type="button"
              onClick={handleConvertToQuote}
              disabled={convertingQuote}
              className="cursor-pointer inline-flex h-7 items-center rounded-md border border-[var(--color-card-border)] px-2 text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)] disabled:opacity-50 disabled:cursor-not-allowed"
              title="Convert to quote"
            >
              {convertingQuote ? 'Creating…' : 'Quote'}
            </button>
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="cursor-pointer flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                title="Edit deal"
                aria-label="Edit deal"
              >
                <Icon name="edit" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
              aria-label="Close deal detail"
            >
              <Icon name="close" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {/* Quote conversion feedback */}
          {quoteResult && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
              <Icon name="check_circle" />
              <span>
                Quote {quoteResult.quoteNumber} created - view in{' '}
                <a
                  href={quotesHref}
                  className="underline"
                  onClick={onClose}
                >
                  Quotes
                </a>
              </span>
            </div>
          )}
          {quoteError && (
            <div className="flex items-center gap-2 rounded-md border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-100">
              <Icon name="error" />
              <span>{quoteError}</span>
            </div>
          )}
          {/* Value + weighted value */}
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <p className={labelCls}>Deal value</p>
              {onEdit ? (
                <button
                  type="button"
                  aria-label={`${hasDealValue ? 'Edit' : 'Add'} value for ${dealLabel} from deal detail`}
                  onClick={onEdit}
                  className="text-left text-lg text-[var(--color-pib-text)] transition-colors hover:text-[var(--color-accent-text)]"
                >
                  {dealValueLabel}
                </button>
              ) : (
                <p className="text-lg text-[var(--color-pib-text)]">
                  {dealValueLabel}
                </p>
              )}
            </div>
            <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
              <p className={labelCls}>Weighted</p>
              <p className="text-sm font-mono text-[var(--color-pib-text)]">
                {weightedValue === null ? 'Value needed' : fmtValue(weightedValue, deal.currency)}
              </p>
            </div>
          </div>

          {/* Probability */}
          <div>
            <p className={labelCls}>Probability</p>
            <div className="flex items-center gap-3">
              {/* Progress bar */}
              <div className="flex-1 h-1.5 rounded bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded transition-all ${probability >= 70 ? 'bg-emerald-400' : probability >= 40 ? 'bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)]' : 'bg-red-400'}`}
                  style={{ width: `${probability}%` }}
                />
              </div>
              <span className={`rounded px-2 py-0.5 font-mono text-xs  ${probability >= 70 ? 'bg-emerald-400/10 text-emerald-300' : probability >= 40 ? 'bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] text-[var(--st-warning)]' : 'bg-red-400/10 text-red-300'}`}>
                {probability}%
              </span>
            </div>
          </div>

          {/* Lost reason */}
          {showLostReason && deal.lostReason && (
            <div>
              <p className={labelCls}>Lost reason</p>
              <p className="text-xs leading-5 text-[var(--color-pib-text-muted)] whitespace-pre-wrap rounded-md px-3 py-2 bg-white/[0.03] border border-[var(--color-card-border)]">
                {deal.lostReason}
              </p>
            </div>
          )}

          {/* Notes */}
          {deal.notes && (
            <div>
              <p className={labelCls}>Notes</p>
              <p className="text-xs leading-5 text-[var(--color-pib-text)] whitespace-pre-wrap">{deal.notes}</p>
            </div>
          )}

          <div
            className="rounded-md border border-[var(--color-card-border)] bg-white/[0.02] p-3"
            aria-label="Relationship context"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={labelCls}>Relationship context</p>
                <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  People, account, owner, and timing signals for this opportunity.
                </p>
              </div>
              <Icon name="hub" />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
                <p className={labelCls}>Contact</p>
                {deal.contactId ? (
                  <a
                    href={contactHref}
                    className="text-xs text-[var(--color-accent-text)] hover:underline"
                  >
                    {readableContact}
                  </a>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-[var(--color-pib-text-muted)]">No decision-maker linked</p>
                    {onEdit ? (
                      <button
                        type="button"
                        aria-label={`Link decision-maker for ${dealLabel}`}
                        onClick={onEdit}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] font-medium text-[var(--color-accent-text)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                      >
                        <Icon name="person_add" />
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
                    className="text-xs text-[var(--color-accent-text)] hover:underline"
                  >
                    {readableCompany}
                  </a>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-[var(--color-pib-text-muted)]">{readableCompany || 'No company linked'}</p>
                    {onEdit ? (
                      <button
                        type="button"
                        aria-label={`Link company for ${dealLabel}`}
                        onClick={onEdit}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] font-medium text-[var(--color-accent-text)] transition-colors hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                      >
                        <Icon name="add_business" />
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
                    <p className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                      Deal owner missing
                    </p>
                    <h3 className="text-xs text-[var(--color-pib-text)]">Assign forecast ownership</h3>
                    <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">
                      No team member owns this opportunity. Assign an owner so follow-up, forecast review, and handoff accountability are visible before the deal stalls.
                    </p>
                    {onEdit ? (
                      <button
                        type="button"
                        aria-label={`Assign owner for ${dealLabel}`}
                        onClick={onEdit}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                      >
                        <Icon name="person_add" />
                        Assign owner
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--color-pib-text)]">{ownerLabel}</p>
                )}
              </div>
              <div className="rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-2">
                <p className={labelCls}>Close date</p>
                {needsCloseDate ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                      {closeDateLabel === 'No close date' ? 'Close date missing' : closeDateLabel}
                    </p>
                    <h3 className="text-xs text-[var(--color-pib-text)]">{closeDateActionHeading}</h3>
                    <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">
                      {closeDateActionDescription}
                    </p>
                    {onEdit ? (
                      <button
                        type="button"
                        aria-label={`${closeDateActionLabel} for ${dealLabel}`}
                        onClick={onEdit}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                      >
                        <Icon name="event_upcoming" />
                        {closeDateActionLabel}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--color-pib-text)]">{closeDateLabel}</p>
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
