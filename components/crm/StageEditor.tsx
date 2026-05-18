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
    <p className="text-xs text-amber-500 flex items-center gap-1 mt-1">
      <span className="material-symbols-outlined text-[14px]">warning</span>
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
      className="flex items-center gap-2 px-3 py-2 bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-lg"
    >
      {/* Drag handle */}
      <button
        type="button"
        aria-label={`Drag to reorder stage ${stage.label}`}
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors touch-none shrink-0"
      >
        <span className="material-symbols-outlined text-[18px]">drag_indicator</span>
      </button>

      {/* Label input */}
      <input
        type="text"
        aria-label={`Stage label for ${stage.id}`}
        value={stage.label}
        onChange={(e) => onChange(stage.id, 'label', e.target.value)}
        placeholder="Stage name"
        className="pib-input flex-1 min-w-0 text-sm"
      />

      {/* Kind select */}
      <select
        aria-label={`Stage kind for ${stage.id}`}
        value={stage.kind}
        onChange={(e) => onChange(stage.id, 'kind', e.target.value as StageKind)}
        className="pib-input text-sm cursor-pointer w-24 shrink-0"
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
        <span className="text-xs text-[var(--color-pib-text-muted)] w-8 text-right tabular-nums">
          {stage.probability}%
        </span>
      </div>

      {/* Color picker */}
      <input
        type="color"
        aria-label={`Stage color for ${stage.id}`}
        value={stage.color ?? '#888888'}
        onChange={(e) => onChange(stage.id, 'color', e.target.value)}
        className="w-7 h-7 rounded cursor-pointer border border-[var(--color-pib-line)] shrink-0"
      />

      {/* Remove button */}
      <button
        type="button"
        aria-label={`Remove stage ${stage.label}`}
        onClick={() => onRemove(stage.id)}
        disabled={!canRemove}
        className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
      >
        <span className="material-symbols-outlined text-[18px]">close</span>
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
      {/* Warnings — client-side hints, server enforces */}
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
        className="cursor-pointer text-xs text-[var(--color-accent-v2)] hover:underline flex items-center gap-1 mt-2"
      >
        <span className="material-symbols-outlined text-[14px]">add</span>
        Add stage
      </button>
    </div>
  )
}
