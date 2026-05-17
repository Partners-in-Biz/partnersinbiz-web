'use client'

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
import type { Deal, DealStage } from '@/lib/crm/types'

// ── Stage constants ────────────────────────────────────────────────────────────

export const DEAL_STAGES: DealStage[] = ['discovery', 'proposal', 'negotiation', 'won', 'lost']

export const STAGE_LABELS: Record<DealStage, string> = {
  discovery:   'Discovery',
  proposal:    'Proposal',
  negotiation: 'Negotiation',
  won:         'Won',
  lost:        'Lost',
}

const STAGE_COLORS: Record<DealStage, string> = {
  discovery:   '#60a5fa',
  proposal:    'var(--color-accent-v2)',
  negotiation: '#c084fc',
  won:         '#4ade80',
  lost:        '#ef4444',
}

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
}

function DealCard({ deal }: DealCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
    >
      <div
        className="pib-card cursor-pointer select-none transition-all duration-150 hover:border-[var(--color-accent-v2)]"
        style={{ padding: '10px', borderLeft: `3px solid ${STAGE_COLORS[deal.stage]}` }}
      >
        <p className="text-sm font-medium text-on-surface mb-2 leading-snug">{deal.title}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-mono text-on-surface-variant font-semibold">
            {formatValue(deal.value, deal.currency)}
          </span>
          {deal.contactId && (
            <Link
              href={`/portal/crm/contacts/${deal.contactId}`}
              onClick={e => e.stopPropagation()}
              className="text-[10px] font-label px-2 py-0.5 rounded-full truncate max-w-[120px]"
              style={{ background: 'var(--color-surface-container)', color: 'var(--color-on-surface-variant)' }}
              title="View contact"
            >
              Contact
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
  stage: DealStage
  deals: Deal[]
}

function DealColumn({ stage, deals }: DealColumnProps) {
  const dealIds = deals.map(d => d.id)
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  const color = STAGE_COLORS[stage]

  return (
    <div className="flex flex-col w-64 shrink-0">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">
          {STAGE_LABELS[stage]}
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
            <DealCard key={deal.id} deal={deal} />
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

function DragGhost({ deal }: { deal: Deal }) {
  return (
    <div
      className="pib-card select-none w-64"
      style={{ padding: '10px', borderLeft: `3px solid ${STAGE_COLORS[deal.stage]}`, opacity: 0.9 }}
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
  loading?: boolean
  onStageChange: (dealId: string, newStage: DealStage) => Promise<void>
}

function Skeleton() {
  return <div className="pib-skeleton h-16 rounded-lg" />
}

export function DealKanban({ deals: initialDeals, loading = false, onStageChange }: DealKanbanProps) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Keep local state in sync when parent re-fetches
  // (only update if not currently dragging to avoid jitter)
  const [isDragging, setIsDragging] = useState(false)
  if (!isDragging && JSON.stringify(deals.map(d => d.id + d.stage)) !== JSON.stringify(initialDeals.map(d => d.id + d.stage))) {
    setDeals(initialDeals)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const getDealsForStage = useCallback(
    (stage: DealStage) => deals.filter(d => d.stage === stage),
    [deals],
  )

  const activeDeal = activeId ? deals.find(d => d.id === activeId) ?? null : null

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
    const overStage = DEAL_STAGES.find(s => s === over.id)
    const targetStage: DealStage = overDeal ? overDeal.stage : overStage ?? activeDeal.stage
    if (activeDeal.stage !== targetStage) {
      setDeals(prev => prev.map(d => d.id === active.id ? { ...d, stage: targetStage } : d))
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
    const overStage = DEAL_STAGES.find(s => s === over.id)
    const targetStage: DealStage = overDeal ? overDeal.stage : overStage ?? movedDeal.stage

    if (movedDeal.stage === targetStage) return

    // Optimistic update already applied in handleDragOver
    const previousStage = initialDeals.find(d => d.id === movedDeal.id)?.stage ?? movedDeal.stage
    try {
      await onStageChange(movedDeal.id, targetStage)
    } catch {
      // Roll back on error
      setDeals(prev => prev.map(d => d.id === movedDeal.id ? { ...d, stage: previousStage } : d))
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
        {DEAL_STAGES.map(stage =>
          loading ? (
            <div key={stage} className="flex flex-col w-64 shrink-0">
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="w-2 h-2 rounded-full" style={{ background: STAGE_COLORS[stage] }} />
                <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">
                  {STAGE_LABELS[stage]}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                <Skeleton /><Skeleton /><Skeleton />
              </div>
            </div>
          ) : (
            <DealColumn key={stage} stage={stage} deals={getDealsForStage(stage)} />
          ),
        )}
      </div>

      <DragOverlay>
        {activeDeal ? <DragGhost deal={activeDeal} /> : null}
      </DragOverlay>
    </DndContext>
  )
}
