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

function formatValue(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
  } catch {
    return `${currency} ${value.toFixed(0)}`
  }
}

interface DealCardProps {
  deal: Deal
  stageColor?: string
  contactBasePath?: string
  contactLabel?: string
}

function DealCard({ deal, stageColor = '#6b7280', contactBasePath = '/portal/contacts', contactLabel }: DealCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id })
  const readableContactLabel = contactLabel?.trim() || 'Contact'

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
        <p className="text-sm font-medium text-on-surface mb-2 leading-snug">{deal.title}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-mono text-on-surface-variant font-semibold">
            {formatValue(deal.value, deal.currency)}
          </span>
          {deal.contactId && (
            <Link
              href={`${contactBasePath}/${deal.contactId}`}
              onClick={e => e.stopPropagation()}
              className="text-[10px] font-label px-2 py-0.5 rounded-full truncate max-w-[120px]"
              style={{ background: 'var(--color-surface-container)', color: 'var(--color-on-surface-variant)' }}
              title="View contact"
            >
              {readableContactLabel}
            </Link>
          )}
        </div>
        {deal.companyName && (
          <span className="text-xs text-gray-500 truncate mt-1 block">{deal.companyName}</span>
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
  contactLabelsById?: Record<string, string>
}

function DealColumn({ stage, deals, contactBasePath, contactLabelsById }: DealColumnProps) {
  const dealIds = deals.map(d => d.id)
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const color = stage.color ?? '#6b7280'

  return (
    <div className="flex flex-col w-64 shrink-0">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3 px-1">
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
              contactLabel={contactLabelsById?.[deal.contactId]}
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
  return (
    <div
      className="pib-card select-none w-64"
      style={{ padding: '10px', borderLeft: `3px solid ${stageColor}`, opacity: 0.9 }}
    >
      <p className="text-sm font-medium text-on-surface mb-2 leading-snug">{deal.title}</p>
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
  contactLabelsById?: Record<string, string>
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
  contactLabelsById,
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
              contactLabelsById={contactLabelsById}
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
