'use client'

import { useEffect, useState } from 'react'
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
  canReorder?: boolean
}

// ── Type chip ─────────────────────────────────────────────────────────────────

function TypeChip({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]">
      {type}
    </span>
  )
}

function fieldHealth(def: CustomFieldDefinition): number {
  const needsOptions = def.type === 'dropdown' || def.type === 'multi_select'
  const hasConstraints = Boolean(def.minLength || def.maxLength || def.min != null || def.max != null || def.currencyCode)
  const checks = [
    Boolean(def.label?.trim()),
    Boolean(def.key?.trim()),
    Boolean(def.group?.trim()),
    Boolean(def.helpText?.trim()),
    !needsOptions || Boolean(def.options?.length),
    !['text', 'longtext', 'number', 'currency'].includes(def.type) || hasConstraints || Boolean(def.required),
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

// ── Sortable row ──────────────────────────────────────────────────────────────

function SortableRow({
  def,
  isAdmin,
  canReorder,
  onEdit,
  onDelete,
}: {
  def: CustomFieldDefinition
  isAdmin: boolean
  canReorder: boolean
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
  const health = fieldHealth(def)
  const optionCount = def.options?.length ?? 0
  const hasConstraint = Boolean(def.minLength || def.maxLength || def.min != null || def.max != null || def.currencyCode)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bento-card !p-0 overflow-hidden"
    >
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {/* Drag handle (admin only) */}
          {isAdmin && canReorder && (
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
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-base font-semibold text-[var(--color-pib-text)] truncate">{def.label}</p>
              <TypeChip type={def.type} />
              {def.required && (
                <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-[10px] font-medium text-red-200">Required</span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${health >= 80 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-200'}`}>
                {health >= 80 ? 'Ready' : `${health}% setup`}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)] font-mono truncate">{def.key}</p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)] line-clamp-2">
              {def.helpText || 'No help text yet. Add context so the team knows when and why to capture this data.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center lg:w-[250px]">
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-2">
            <p className="truncate text-xs font-medium text-[var(--color-pib-text)]" title={def.group || 'Other'}>{def.group || 'Other'}</p>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Group</p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-2">
            <p className="font-display text-lg text-[var(--color-pib-text)]">{optionCount || (hasConstraint ? 'Set' : '-')}</p>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Rules</p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-2">
            <p className="font-display text-lg text-[var(--color-pib-text)]">{def.order}</p>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)]">Order</p>
          </div>
        </div>
      </div>

      {/* Actions (admin only) */}
      {isAdmin && (
        <div className="flex items-center justify-end gap-1 border-t border-[var(--color-pib-line)] px-3 py-2">
          <button
            type="button"
            aria-label={`Edit ${def.label}`}
            onClick={() => onEdit(def)}
            title="Edit field"
            className="cursor-pointer w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06] transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>
          <button
            type="button"
            aria-label={`Delete ${def.label}`}
            onClick={() => onDelete(def)}
            title="Delete field"
            className="cursor-pointer w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-pib-text-muted)] hover:text-red-400 hover:bg-red-400/[0.08] transition-colors"
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
  canReorder = isAdmin,
}: CustomFieldDefinitionsListProps) {
  const [items, setItems] = useState<CustomFieldDefinition[]>(definitions)

  // Keep local state in sync with prop changes
  useEffect(() => {
    setItems(definitions)
  }, [definitions])

  const sensors = useSensors(useSensor(PointerSensor))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIdx = items.findIndex((d) => d.id === active.id)
    const newIdx = items.findIndex((d) => d.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return

    const reordered = arrayMove(items, oldIdx, newIdx)
    setItems(reordered)
    if (canReorder) onReorder(reordered.map((d) => d.id))
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
      sensors={isAdmin && canReorder ? sensors : undefined}
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
                    canReorder={canReorder}
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
