'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CrossProjectTaskCard } from './CrossProjectTaskCard'
import type { Column, Task } from '@/components/kanban/types'

// Single source of truth for this type - re-exported by CrossProjectBoard.tsx
export type BoardTask = Task & { projectId: string; projectName: string }

interface BoardColumnProps {
  column: Column
  tasks: BoardTask[]
  buildProjectHref?: (projectId: string) => string
  onTaskClick: (task: BoardTask) => void
}

export function BoardColumn({ column, tasks, buildProjectHref, onTaskClick }: BoardColumnProps) {
  const taskIds = tasks.map(t => t.id)
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <div className="flex w-60 shrink-0 flex-col" data-module-accent="cyan">
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <div className="h-1.5 w-1.5 shrink-0 rounded-md" style={{ background: column.color }} />
        <span className="pib-label">{column.name}</span>
        <span className="ml-auto rounded-md bg-[color-mix(in_srgb,var(--sc-ink)_6%,transparent)] px-1.5 py-0.5 text-[9px] font-label tabular-nums text-[#5EEAD4]">
          {tasks.length}
        </span>
      </div>

      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex min-h-20 flex-1 flex-col gap-1.5 rounded-lg transition-colors"
          style={isOver ? { background: 'color-mix(in oklab, var(--color-accent-v2) 8%, transparent)' } : undefined}
        >
          {tasks.map(task => (
            <CrossProjectTaskCard
              key={task.id}
              task={task}
              projectId={task.projectId}
              projectName={task.projectName}
              projectHref={buildProjectHref?.(task.projectId)}
              onClick={() => onTaskClick(task)}
            />
          ))}
          {tasks.length === 0 && (
            <div className="flex items-center justify-center rounded-[var(--radius-card)] border border-dashed border-[var(--color-pib-line)] py-6">
              <p className="text-xs text-[var(--color-pib-text-muted)]">Drop here</p>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  )
}
