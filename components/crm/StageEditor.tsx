'use client'

import { useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Icon } from '@/components/studio'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PipelineStage, StageKind } from '@/lib/pipelines/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface StageEditorProps {
  stages: PipelineStage[]
  onChange: (next: PipelineStage[]) => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

const KIND_LABELS: Record<StageKind, string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
}

const ALL_KINDS: StageKind[] = ['open', 'won', 'lost']

// ── Helpers ───────────────────────────────────────────────────────────────────

function countKind(stages: PipelineStage[], kind: StageKind): number {
  return stages.filter((s) => s.kind === kind).length
}

function StageWarning({ message }: { message: string }) {
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-[var(--st-warning)]">
      <Icon name="warning" className="text-[14px]" />
      {message}
    </p>
  )
}

// ── Sortable stage row ────────────────────────────────────────────────────────

interface SortableStageRowProps {
  stage: PipelineStage
  canRemove: boolean
  onChange: (id: string, field: keyof PipelineStage, value: string | number) => void
  onRemove: (id: string) => void
}

function SortableStageRow({ stage, canRemove, onChange, onRemove }: SortableStageRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border border-[var(--color-card-border)] bg-black/10 px-2 py-1.5"
    >
      {/* Drag handle */}
      <button
        type="button"
        aria-label={`Drag to reorder stage ${stage.label}`}
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab touch-none text-[var(--color-pib-text-muted)] transition hover:text-[var(--color-pib-text)] active:cursor-grabbing"
      >
        <Icon name="drag_indicator" className="text-[16px]" />
      </button>

      {/* Label input */}
      <input
        type="text"
        aria-label={`Stage label for ${stage.id}`}
        value={stage.label}
        onChange={(e) => onChange(stage.id, 'label', e.target.value)}
        placeholder="Stage name"
        className="h-8 min-w-0 flex-1 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]"
      />

      {/* Kind select */}
      <select
        aria-label={`Stage kind for ${stage.id}`}
        value={stage.kind}
        onChange={(e) => onChange(stage.id, 'kind', e.target.value as StageKind)}
        className="h-8 w-24 shrink-0 cursor-pointer rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-[var(--color-pib-text)]"
      >
        {ALL_KINDS.map((k) => (
          <option key={k} value={k}>{KIND_LABELS[k]}</option>
        ))}
      </select>

      {/* Probability */}
      <div className="flex items-center gap-1 shrink-0">
        <input
          type="range"
          aria-label={`Stage probability for ${stage.id}`}
          min={0}
          max={100}
          step={1}
          value={stage.probability}
          onChange={(e) => onChange(stage.id, 'probability', parseInt(e.target.value, 10))}
          className="w-20 cursor-pointer"
        />
        <span className="w-8 text-right text-xs tabular-nums text-[var(--color-pib-text-muted)]">
          {stage.probability}%
        </span>
      </div>

      {/* Color picker */}
      <input
        type="color"
        aria-label={`Stage color for ${stage.id}`}
        value={stage.color ?? '#888888'}
        onChange={(e) => onChange(stage.id, 'color', e.target.value)}
        className="h-7 w-7 shrink-0 cursor-pointer rounded border border-[var(--color-card-border)]"
      />

      {/* Remove button */}
      <button
        type="button"
        aria-label={`Remove stage ${stage.label}`}
        onClick={() => onRemove(stage.id)}
        disabled={!canRemove}
        className="shrink-0 cursor-pointer text-[var(--color-pib-text-muted)] transition hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Icon name="close" className="text-[16px]" />
      </button>
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export function StageEditor({ stages, onChange }: StageEditorProps) {
  const sensors = useSensors(useSensor(PointerSensor))

  const wonCount = countKind(stages, 'won')
  const lostCount = countKind(stages, 'lost')

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = stages.findIndex((s) => s.id === active.id)
    const newIdx = stages.findIndex((s) => s.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    const reordered = arrayMove(stages, oldIdx, newIdx).map((s, i) => ({ ...s, order: i }))
    onChange(reordered)
  }, [stages, onChange])

  function handleFieldChange(id: string, field: keyof PipelineStage, value: string | number) {
    onChange(stages.map((s) => s.id === id ? { ...s, [field]: value } : s))
  }

  function handleRemove(id: string) {
    const next = stages.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i }))
    onChange(next)
  }

  function handleAddStage() {
    const id = `stage_${Date.now()}`
    const newStage: PipelineStage = {
      id,
      label: 'New Stage',
      kind: 'open',
      order: stages.length,
      probability: 50,
    }
    onChange([...stages, newStage])
  }

  // Removal is disabled only if we'd leave 0 stages
  function canRemoveStage(): boolean {
    return stages.length > 1
  }

  return (
    <div className="space-y-2">
      {/* Warnings - client-side hints, server enforces */}
      {wonCount === 0 && <StageWarning message="At least one Won stage is required." />}
      {wonCount > 1 && <StageWarning message="Only one Won stage allowed per pipeline." />}
      {lostCount === 0 && <StageWarning message="At least one Lost stage is required." />}
      {lostCount > 1 && <StageWarning message="Only one Lost stage allowed per pipeline." />}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {stages.map((stage) => (
              <SortableStageRow
                key={stage.id}
                stage={stage}
                canRemove={canRemoveStage()}
                onChange={handleFieldChange}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add stage */}
      <button
        type="button"
        onClick={handleAddStage}
        className="mt-2 flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-[var(--color-accent-text)] transition hover:bg-white/[0.05]"
      >
        <Icon name="add" className="text-[14px]" />
        Add stage
      </button>
    </div>
  )
}
