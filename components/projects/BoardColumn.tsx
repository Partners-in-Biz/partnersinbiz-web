'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CrossProjectTaskCard } from './CrossProjectTaskCard'
import type { Column, Task } from '@/components/kanban/types'

// Single source of truth for this type — re-exported by CrossProjectBoard.tsx
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
    <div className="flex flex-col w-64 shrink-0">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: column.color }} />
        <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">
          {column.name}
        </span>
        <span
          className="text-[9px] font-label px-1.5 py-0.5 rounded-full ml-auto"
          style={{ background: 'var(--color-surface-container)', color: 'var(--color-on-surface-variant)' }}
        >
          {tasks.length}
        </span>
      </div>

      {/* Drop zone */}
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex flex-col gap-2 min-h-24 flex-1 rounded-lg transition-colors"
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
