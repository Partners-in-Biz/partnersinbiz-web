'use client'

import { useState, useCallback, useEffect } from 'react'
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
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { BoardColumn } from './BoardColumn'
import { CrossProjectTaskCard } from './CrossProjectTaskCard'
import { TaskDetailPanel } from '@/components/kanban/TaskDetailPanel'
import { timestampToDate } from '@/lib/tasks/dateTimeDisplay'
import type { Column, Task } from '@/components/kanban/types'
import type { BoardTask } from './BoardColumn'

// Re-export so ProjectsPage can import BoardTask from one place
export type { BoardTask }

const BOARD_COLUMNS: Column[] = [
  { id: 'backlog',     name: 'Backlog',     color: 'var(--color-outline)',    order: 0 },
  { id: 'todo',        name: 'To Do',       color: '#60a5fa',                 order: 1 },
  { id: 'in_progress', name: 'In Progress', color: 'var(--color-accent-v2)', order: 2 },
  { id: 'blocked',     name: 'Blocked',     color: '#ef4444',                 order: 3 },
  { id: 'review',      name: 'Review',      color: '#c084fc',                 order: 4 },
  { id: 'done',        name: 'Done',        color: '#4ade80',                 order: 5 },
]

function normalizeColumnId(columnId: string): string {
  return BOARD_COLUMNS.some(c => c.id === columnId) ? columnId : 'backlog'
}

function getTaskCreatedAtMillis(task: Task): number | null {
  const date = timestampToDate(task.createdAt)
  return date ? date.getTime() : null
}

function Skeleton() {
  return <div className="pib-skeleton h-16 rounded-lg" />
}

interface CrossProjectBoardProps {
  tasks: BoardTask[]
  loading: boolean
  onTaskUpdate: (projectId: string, taskId: string, patch: Partial<Task>) => void
  sortMode?: 'latest' | 'manual'
  buildProjectHref?: (projectId: string) => string
}

export function CrossProjectBoard({ tasks: initialTasks, loading, onTaskUpdate, sortMode = 'latest', buildProjectHref }: CrossProjectBoardProps) {
  const [tasks, setTasks] = useState<BoardTask[]>([])
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null)
  const [selectedTask, setSelectedTask] = useState<BoardTask | null>(null)

  useEffect(() => {
    // Keep the optimistic drag/drop copy in sync with live Firestore task props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTasks(initialTasks.map(t => ({ ...t, columnId: normalizeColumnId(t.columnId) })))
  }, [initialTasks])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const getTasksForColumn = useCallback(
    (columnId: string) => tasks
      .filter(t => t.columnId === columnId)
      .sort((a, b) => {
        if (sortMode === 'latest') {
          const aCreatedAt = getTaskCreatedAtMillis(a)
          const bCreatedAt = getTaskCreatedAtMillis(b)
          if (aCreatedAt !== null && bCreatedAt !== null && aCreatedAt !== bCreatedAt) {
            return bCreatedAt - aCreatedAt
          }
          if (aCreatedAt !== null && bCreatedAt === null) return -1
          if (aCreatedAt === null && bCreatedAt !== null) return 1
        }
        return a.order - b.order
      }),
    [sortMode, tasks],
  )

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find(t => t.id === event.active.id)
    setActiveTask(task ?? null)
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    const activeT = tasks.find(t => t.id === active.id)
    if (!activeT) return
    const overTask = tasks.find(t => t.id === over.id)
    const overCol = BOARD_COLUMNS.find(c => c.id === over.id)
    const targetColumnId = overTask ? overTask.columnId : overCol ? overCol.id : activeT.columnId
    if (activeT.columnId !== targetColumnId) {
      setTasks(prev => prev.map(t => t.id === active.id ? { ...t, columnId: targetColumnId } : t))
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveTask(null)
    if (!over) return
    const movedTask = tasks.find(t => t.id === active.id)
    if (!movedTask) return

    const overTask = tasks.find(t => t.id === over.id)
    const overCol = BOARD_COLUMNS.find(c => c.id === over.id)
    const targetColumnId = overTask ? overTask.columnId : overCol ? overCol.id : movedTask.columnId
    const colTasks = tasks
      .filter(t => t.columnId === targetColumnId && t.id !== movedTask.id)
      .sort((a, b) => a.order - b.order)
    const targetIndex = overTask ? Math.max(0, colTasks.findIndex(t => t.id === overTask.id)) : colTasks.length
    const prev = colTasks[targetIndex - 1]?.order
    const next = colTasks[targetIndex]?.order
    const newOrder =
      typeof prev === 'number' && typeof next === 'number' ? (prev + next) / 2
      : typeof next === 'number' ? next - 1
      : typeof prev === 'number' ? prev + 1
      : Date.now()

    const patch = { columnId: targetColumnId, order: newOrder }
    setTasks(prevTasks => prevTasks.map(t => t.id === active.id ? { ...t, ...patch } : t))
    try {
      onTaskUpdate(movedTask.projectId, movedTask.id, patch)
    } catch {
      setTasks(initialTasks.map(t => ({ ...t, columnId: normalizeColumnId(t.columnId) })))
    }
  }

  const handleTaskUpdate = useCallback(async (taskId: string, updates: Partial<Task>) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))
    setSelectedTask(prev => prev?.id === taskId ? { ...prev, ...updates } as BoardTask : prev)
    onTaskUpdate(task.projectId, taskId, updates)
  }, [tasks, onTaskUpdate])

  const handleTaskDelete = useCallback(async (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    setSelectedTask(null)
  }, [])

  const hasAnyTasks = tasks.length > 0

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 400 }}>
          {BOARD_COLUMNS.map(column => (
            loading ? (
              <div key={column.id} className="flex flex-col w-64 shrink-0">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: column.color }} />
                  <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{column.name}</span>
                </div>
                <div className="flex flex-col gap-2">
                  <Skeleton /><Skeleton /><Skeleton />
                </div>
              </div>
            ) : (
              <BoardColumn
                key={column.id}
                column={column}
                tasks={getTasksForColumn(column.id)}
                buildProjectHref={buildProjectHref}
                onTaskClick={setSelectedTask}
              />
            )
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <CrossProjectTaskCard
              task={activeTask}
              projectId={activeTask.projectId}
              projectName={activeTask.projectName}
              projectHref={buildProjectHref?.(activeTask.projectId)}
              onClick={() => {}}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {!loading && !hasAnyTasks && (
        <div className="py-12 text-center">
          <p className="text-on-surface-variant text-sm">No tasks yet. Open a project to add some.</p>
        </div>
      )}

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          projectId={selectedTask.projectId}
          columnName={BOARD_COLUMNS.find(c => c.id === selectedTask.columnId)?.name ?? ''}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleTaskUpdate}
          onDelete={handleTaskDelete}
        />
      )}
    </>
  )
}
