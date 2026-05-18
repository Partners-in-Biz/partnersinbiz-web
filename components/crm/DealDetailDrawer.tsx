'use client'

/**
 * DealDetailDrawer — read-only deal detail panel
 *
 * A5: shows probability badge + weighted value, lost reason, and line items.
 */

import type { Deal, Currency } from '@/lib/crm/types'
import type { PipelineStage } from '@/lib/pipelines/types'
import { DealLineItemsEditor } from './DealLineItemsEditor'

export interface DealDetailDrawerProps {
  deal: Deal
  stages: PipelineStage[]
  orgId: string
  onClose: () => void
  onEdit?: () => void
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

export function DealDetailDrawer({ deal, stages, orgId, onClose, onEdit }: DealDetailDrawerProps) {
  const stage = stages.find(s => s.id === deal.stageId)
  const stageColor = stage?.color ?? (stage?.kind === 'won' ? '#4ade80' : stage?.kind === 'lost' ? '#ef4444' : '#60a5fa')
  const showLostReason = isLostStage(stage)

  const probability = deal.probability ?? (stage?.probability ?? 100)
  const weightedValue = (deal.value ?? 0) * (probability / 100)

  const labelCls = 'block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1'

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
            <p className="text-sm font-semibold text-[var(--color-pib-text)] truncate">{deal.title}</p>
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
          {/* Value + weighted value */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <p className={labelCls}>Deal value</p>
              <p className="text-xl font-headline font-bold text-[var(--color-pib-text)]">
                {fmtValue(deal.value ?? 0, deal.currency)}
              </p>
            </div>
            <div
              className="px-3 py-2 rounded-lg"
              style={{ background: 'var(--color-surface-container)' }}
            >
              <p className={labelCls}>Weighted</p>
              <p className="text-sm font-mono font-semibold text-[var(--color-pib-text)]">
                {fmtValue(weightedValue, deal.currency)}
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
