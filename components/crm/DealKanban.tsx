'use client'

// A3 W2-F: DealStage type removed. This component is scheduled for full
// refactor in W3-H which will fetch the pipeline document and build columns
// dynamically from pipeline.stages rather than hard-coded DealStage values.
//
// For now, the kanban renders a read-only flat list of deals grouped by stageId
// (string). The onStageChange callback signature is updated to take stageId string.
// The full drag-and-drop per-pipeline-column UX is W3-H's responsibility.

import { useState, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDroppable } from '@dnd-kit/core'
import Link from 'next/link'
import type { Deal } from '@/lib/crm/types'
import type { PipelineStage } from '@/lib/pipelines/types'

// ── Internal deal card ─────────────────────────────────────────────────────────

function formatValue(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'No value captured'
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
  } catch {
    return `${currency} ${value.toFixed(0)}`
  }
}

function dealTitleLabel(deal: Deal): string {
  return deal.title?.trim() || 'Deal name missing'
}

// US-059: sum the captured value of every deal in a stage and render it with the
// stage's currency (deals in a column can in theory differ; we use the first
// deal's currency, defaulting to ZAR — matching formatValue's locale).
function formatColumnTotal(deals: Deal[]): string {
  const valued = deals.filter(
    d => d.value !== null && d.value !== undefined && !Number.isNaN(d.value),
  )
  const total = valued.reduce((sum, d) => sum + (d.value || 0), 0)
  const currency = valued[0]?.currency || deals[0]?.currency || 'ZAR'
  return formatValue(total, currency)
}

// Firestore Timestamps arrive over the wire as { _seconds } (admin SDK) or
// { seconds } (client SDK). Normalise to milliseconds; return null when absent.
function timestampToMs(ts: unknown): number | null {
  if (!ts || typeof ts !== 'object') return null
  const t = ts as { _seconds?: number; seconds?: number; toMillis?: () => number }
  if (typeof t.toMillis === 'function') {
    try {
      return t.toMillis()
    } catch {
      /* fall through */
    }
  }
  const secs = t._seconds ?? t.seconds
  return typeof secs === 'number' ? secs * 1000 : null
}

// US-059: when did this deal enter its current stage? Prefer the stageHistory
// entry for the current stageId (latest enteredAt), then fall back to the deal's
// updatedAt, then createdAt.
function stageEnteredMs(deal: Deal): number | null {
  let best: number | null = null
  for (const entry of deal.stageHistory ?? []) {
    if (entry.stageId !== deal.stageId) continue
    const ms = timestampToMs(entry.enteredAt)
    if (ms !== null && (best === null || ms > best)) best = ms
  }
  if (best !== null) return best
  return timestampToMs(deal.updatedAt) ?? timestampToMs(deal.createdAt)
}

// US-059: human-readable days-in-stage label, e.g. "Today", "1 day", "12 days".
function daysInStageLabel(deal: Deal): string | null {
  const enteredMs = stageEnteredMs(deal)
  if (enteredMs === null) return null
  const days = Math.floor((Date.now() - enteredMs) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'Today'
  return `${days} day${days === 1 ? '' : 's'}`
}

interface DealCardProps {
  deal: Deal
  stageColor?: string
  contactBasePath?: string
  companyBasePath?: string
  contactHrefForDeal?: (deal: Deal) => string
  companyHrefForDeal?: (deal: Deal) => string
  contactLabel?: string
  onEditDeal?: (deal: Deal) => void
}

function DealCard({
  deal,
  stageColor = '#6b7280',
  contactBasePath = '/portal/contacts',
  companyBasePath = '/portal/companies',
  contactHrefForDeal,
  companyHrefForDeal,
  contactLabel,
  onEditDeal,
}: DealCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id })
  const titleLabel = dealTitleLabel(deal)
  const hasValue = deal.value !== null && deal.value !== undefined && !Number.isNaN(deal.value)
  const valueLabel = formatValue(deal.value, deal.currency)
  const readableContactLabel = contactLabel?.trim() || 'Contact identity missing'
  const readableCompanyLabel = deal.companyName?.trim() || (deal.companyId ? 'Company identity missing' : '')
  const contactHref = contactHrefForDeal ? contactHrefForDeal(deal) : `${contactBasePath}/${deal.contactId}`
  const companyHref = companyHrefForDeal ? companyHrefForDeal(deal) : `${companyBasePath}/${deal.companyId}`
  const daysLabel = daysInStageLabel(deal)

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
    >
      <div
        className="pib-card cursor-pointer select-none transition-all duration-150 hover:border-[var(--color-accent-v2)]"
        style={{ padding: '10px', borderLeft: `3px solid ${stageColor}` }}
      >
        <p className="text-sm font-medium text-on-surface mb-2 leading-snug">{titleLabel}</p>
        <div className="flex items-center justify-between gap-2">
          {onEditDeal ? (
            <button
              type="button"
              onPointerDown={event => event.stopPropagation()}
              onClick={event => {
                event.stopPropagation()
                onEditDeal(deal)
              }}
              aria-label={`${hasValue ? 'Edit' : 'Add'} value for ${titleLabel} from deal board`}
              className="text-xs font-mono text-on-surface-variant font-semibold transition-colors hover:text-[var(--color-pib-accent)]"
            >
              {valueLabel}
            </button>
          ) : (
            <span className="text-xs font-mono text-on-surface-variant font-semibold">
              {valueLabel}
            </span>
          )}
          {deal.contactId && (
            <Link
              href={contactHref}
              onClick={e => e.stopPropagation()}
              className="text-[10px] font-label px-2 py-0.5 rounded-full truncate max-w-[120px]"
              style={{ background: 'var(--color-surface-container)', color: 'var(--color-on-surface-variant)' }}
              title="View contact"
            >
              {readableContactLabel}
            </Link>
          )}
        </div>
        {deal.companyId ? (
          <Link
            href={companyHref}
            onClick={e => e.stopPropagation()}
            className="text-xs text-gray-500 truncate mt-1 block hover:underline"
            title="View company"
          >
            {readableCompanyLabel}
          </Link>
        ) : readableCompanyLabel ? (
          <span className="text-xs text-gray-500 truncate mt-1 block">{readableCompanyLabel}</span>
        ) : null}
        {daysLabel && (
          <div className="mt-2 flex items-center gap-1 text-[10px] text-on-surface-variant" title="Time in current stage">
            <span className="material-symbols-outlined text-[12px] leading-none" aria-hidden="true">schedule</span>
            <span className="font-label">{daysLabel} in stage</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Column ─────────────────────────────────────────────────────────────────────

interface DealColumnProps {
  stage: PipelineStage
  deals: Deal[]
  contactBasePath?: string
  companyBasePath?: string
  contactHrefForDeal?: (deal: Deal) => string
  companyHrefForDeal?: (deal: Deal) => string
  contactLabelsById?: Record<string, string>
  onEditDeal?: (deal: Deal) => void
}

function DealColumn({
  stage,
  deals,
  contactBasePath,
  companyBasePath,
  contactHrefForDeal,
  companyHrefForDeal,
  contactLabelsById,
  onEditDeal,
}: DealColumnProps) {
  const dealIds = deals.map(d => d.id)
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const color = stage.color ?? '#6b7280'
  const columnTotal = formatColumnTotal(deals)

  return (
    <div className="flex flex-col w-64 shrink-0">
      {/* Column header */}
      <div className="mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
          <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">
            {stage.label}
          </span>
          <span
            className="text-[9px] font-label px-1.5 py-0.5 rounded-full ml-auto"
            style={{ background: 'var(--color-surface-container)', color: 'var(--color-on-surface-variant)' }}
          >
            {deals.length}
          </span>
        </div>
        {/* US-059: per-column total value */}
        <p className="mt-1 text-[11px] font-mono font-semibold text-on-surface-variant" title="Total value of deals in this stage">
          {columnTotal}
        </p>
      </div>

      {/* Drop zone */}
      <SortableContext items={dealIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex flex-col gap-2 min-h-24 flex-1 rounded-lg transition-colors"
          style={isOver ? { background: 'color-mix(in oklab, var(--color-accent-v2) 8%, transparent)' } : undefined}
        >
          {deals.map(deal => (
            <DealCard
              key={deal.id}
              deal={deal}
              stageColor={color}
              contactBasePath={contactBasePath}
              companyBasePath={companyBasePath}
              contactHrefForDeal={contactHrefForDeal}
              companyHrefForDeal={companyHrefForDeal}
              contactLabel={contactLabelsById?.[deal.contactId]}
              onEditDeal={onEditDeal}
            />
          ))}
          {deals.length === 0 && (
            <div
              className="rounded-[var(--radius-card)] border border-dashed flex items-center justify-center py-8"
              style={{ borderColor: 'var(--color-card-border)' }}
            >
              <p className="text-xs text-on-surface-variant">Drop here</p>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  )
}

// ── Overlay card (dragging ghost) ──────────────────────────────────────────────

function DragGhost({ deal, stageColor = '#6b7280' }: { deal: Deal; stageColor?: string }) {
  const titleLabel = dealTitleLabel(deal)

  return (
    <div
      className="pib-card select-none w-64"
      style={{ padding: '10px', borderLeft: `3px solid ${stageColor}`, opacity: 0.9 }}
    >
      <p className="text-sm font-medium text-on-surface mb-2 leading-snug">{titleLabel}</p>
      <span className="text-xs font-mono text-on-surface-variant font-semibold">
        {formatValue(deal.value, deal.currency)}
      </span>
    </div>
  )
}

// ── Public component ───────────────────────────────────────────────────────────

export interface DealKanbanProps {
  deals: Deal[]
  stages: PipelineStage[]   // W3-H: pass pipeline.stages from the parent
  loading?: boolean
  onStageChange: (dealId: string, newStageId: string) => Promise<void>
  contactBasePath?: string
  companyBasePath?: string
  contactHrefForDeal?: (deal: Deal) => string
  companyHrefForDeal?: (deal: Deal) => string
  contactLabelsById?: Record<string, string>
  onEditDeal?: (deal: Deal) => void
}

function Skeleton() {
  return <div className="pib-skeleton h-16 rounded-lg" />
}

export function DealKanban({
  deals: initialDeals,
  stages,
  loading = false,
  onStageChange,
  contactBasePath = '/portal/contacts',
  companyBasePath = '/portal/companies',
  contactHrefForDeal,
  companyHrefForDeal,
  contactLabelsById,
  onEditDeal,
}: DealKanbanProps) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Keep local state in sync when parent re-fetches
  // (only update if not currently dragging to avoid jitter)
  const [isDragging, setIsDragging] = useState(false)
  if (!isDragging && JSON.stringify(deals.map(d => d.id + d.stageId)) !== JSON.stringify(initialDeals.map(d => d.id + d.stageId))) {
    setDeals(initialDeals)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const getDealsForStage = useCallback(
    (stageId: string) => deals.filter(d => d.stageId === stageId),
    [deals],
  )

  const activeDeal = activeId ? deals.find(d => d.id === activeId) ?? null : null
  const activeStage = activeDeal ? stages.find(s => s.id === activeDeal.stageId) : undefined

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
    setIsDragging(true)
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    const activeDeal = deals.find(d => d.id === active.id)
    if (!activeDeal) return
    const overDeal = deals.find(d => d.id === over.id)
    const overStage = stages.find(s => s.id === over.id)
    const targetStageId: string = overDeal ? overDeal.stageId : overStage?.id ?? activeDeal.stageId
    if (activeDeal.stageId !== targetStageId) {
      setDeals(prev => prev.map(d => d.id === active.id ? { ...d, stageId: targetStageId } : d))
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    setIsDragging(false)

    if (!over) return
    const movedDeal = deals.find(d => d.id === active.id)
    if (!movedDeal) return

    const overDeal = deals.find(d => d.id === over.id)
    const overStage = stages.find(s => s.id === over.id)
    const targetStageId: string = overDeal ? overDeal.stageId : overStage?.id ?? movedDeal.stageId

    if (movedDeal.stageId === targetStageId) return

    // Optimistic update already applied in handleDragOver
    const previousStageId = initialDeals.find(d => d.id === movedDeal.id)?.stageId ?? movedDeal.stageId
    try {
      await onStageChange(movedDeal.id, targetStageId)
    } catch {
      // Roll back on error
      setDeals(prev => prev.map(d => d.id === movedDeal.id ? { ...d, stageId: previousStageId } : d))
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 400 }}>
        {stages.map(stage =>
          loading ? (
            <div key={stage.id} className="flex flex-col w-64 shrink-0">
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="w-2 h-2 rounded-full" style={{ background: stage.color ?? '#6b7280' }} />
                <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">
                  {stage.label}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                <Skeleton /><Skeleton /><Skeleton />
              </div>
            </div>
          ) : (
            <DealColumn
              key={stage.id}
              stage={stage}
              deals={getDealsForStage(stage.id)}
              contactBasePath={contactBasePath}
              companyBasePath={companyBasePath}
              contactHrefForDeal={contactHrefForDeal}
              companyHrefForDeal={companyHrefForDeal}
              contactLabelsById={contactLabelsById}
              onEditDeal={onEditDeal}
            />
          ),
        )}
      </div>

      <DragOverlay>
        {activeDeal ? <DragGhost deal={activeDeal} stageColor={activeStage?.color ?? '#6b7280'} /> : null}
      </DragOverlay>
    </DndContext>
  )
}
