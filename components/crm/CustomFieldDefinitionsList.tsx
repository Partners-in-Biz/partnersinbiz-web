'use client'

import { useState } from 'react'
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
import type { CustomFieldDefinition } from '@/lib/customFields/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CustomFieldDefinitionsListProps {
  definitions: CustomFieldDefinition[]
  onEdit: (def: CustomFieldDefinition) => void
  onDelete: (def: CustomFieldDefinition) => void
  onReorder: (newOrder: string[]) => void
  isAdmin: boolean
}

// ── Type chip ─────────────────────────────────────────────────────────────────

function TypeChip({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]">
      {type}
    </span>
  )
}

// ── Sortable row ──────────────────────────────────────────────────────────────

function SortableRow({
  def,
  isAdmin,
  onEdit,
  onDelete,
}: {
  def: CustomFieldDefinition
  isAdmin: boolean
  onEdit: (def: CustomFieldDefinition) => void
  onDelete: (def: CustomFieldDefinition) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: def.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-3 bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-lg"
    >
      {/* Drag handle (admin only) */}
      {isAdmin && (
        <button
          type="button"
          aria-label={`Drag to reorder ${def.label}`}
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors touch-none"
        >
          <span className="material-symbols-outlined text-[18px]">drag_indicator</span>
        </button>
      )}

      {/* Label + key */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-pib-text)] truncate">{def.label}</p>
        <p className="text-xs text-[var(--color-pib-text-muted)] font-mono truncate">{def.key}</p>
      </div>

      {/* Type chip */}
      <TypeChip type={def.type} />

      {/* Actions (admin only) */}
      {isAdmin && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            aria-label={`Edit ${def.label}`}
            onClick={() => onEdit(def)}
            className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors p-1"
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>
          <button
            type="button"
            aria-label={`Delete ${def.label}`}
            onClick={() => onDelete(def)}
            className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-red-400 transition-colors p-1"
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      )}
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

export function CustomFieldDefinitionsList({
  definitions,
  onEdit,
  onDelete,
  onReorder,
  isAdmin,
}: CustomFieldDefinitionsListProps) {
  const [items, setItems] = useState<CustomFieldDefinition[]>(definitions)

  // Keep local state in sync with prop changes
  if (
    definitions.length !== items.length ||
    definitions.some((d, i) => d.id !== items[i]?.id)
  ) {
    setItems(definitions)
  }

  const sensors = useSensors(useSensor(PointerSensor))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIdx = items.findIndex((d) => d.id === active.id)
    const newIdx = items.findIndex((d) => d.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return

    const reordered = arrayMove(items, oldIdx, newIdx)
    setItems(reordered)
    onReorder(reordered.map((d) => d.id))
  }

  // Group by group field
  const groups = new Map<string, CustomFieldDefinition[]>()
  for (const def of items) {
    const group = def.group ?? 'Other'
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(def)
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-[var(--color-pib-text-muted)] italic">
        No custom fields defined yet.
      </p>
    )
  }

  return (
    <DndContext
      sensors={isAdmin ? sensors : undefined}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map((d) => d.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-6">
          {Array.from(groups.entries()).map(([group, defs]) => (
            <div key={group}>
              <h4 className="text-xs font-label text-[var(--color-pib-text-muted)] uppercase tracking-wider mb-2">
                {group}
              </h4>
              <div className="space-y-2">
                {defs.map((def) => (
                  <SortableRow
                    key={def.id}
                    def={def}
                    isAdmin={isAdmin}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
