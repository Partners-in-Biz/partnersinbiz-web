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
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { formatTaskDate, formatTaskDateTime, timestampToDate } from '@/lib/tasks/dateTimeDisplay'
import { buildBlockedTaskRecovery } from '@/lib/projects/blockerRecovery'
import { getTaskStateStyle } from './taskStateStyles'
import type { AgentMember, Column, Task, TeamMember } from './types'

interface KanbanBoardProps {
  columns: Column[]
  tasks: Task[]
  members?: TeamMember[]
  agents?: AgentMember[]
  sortMode?: 'latest' | 'manual'
  onSortModeChange?: (mode: 'latest' | 'manual') => void
  showSortToggle?: boolean
  onTaskMove: (taskId: string, newColumnId: string, newOrder: number) => Promise<void>
  onTaskClick: (task: Task) => void
  onAddTask: (columnId: string) => void
}

// ── Priority styles ───────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, { color: string; label: string }> = {
  urgent: { color: '#ef4444', label: 'Urgent' },
  high:   { color: 'var(--color-accent-v2)', label: 'High' },
  medium: { color: '#60a5fa', label: 'Medium' },
  normal: { color: '#60a5fa', label: 'Normal' },
  low:    { color: 'var(--color-outline)', label: 'Low' },
}

function isDueSoon(value: unknown): boolean {
  const date = timestampToDate(value)
  if (!date) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const limit = new Date(today)
  limit.setDate(today.getDate() + 3)
  return date >= today && date <= limit
}

function attachmentKind(task: Task): 'image' | 'video' | 'file' | null {
  const first = task.attachments?.[0]
  if (!first) return null
  const type = (first.mimeType ?? first.type ?? '').toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  return 'file'
}

function memberInitials(member?: TeamMember): string {
  const label = member?.displayName || member?.email || '?'
  return label
    .split(/[ @.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?'
}

function findMember(members: TeamMember[] | undefined, id: string): TeamMember | undefined {
  const normalized = id.toLowerCase()
  return members?.find((member) =>
    member.userId === id ||
    member.email?.toLowerCase() === normalized,
  )
}

function MemberAvatar({ member, fallbackId }: { member?: TeamMember; fallbackId: string }) {
  const [imageFailed, setImageFailed] = useState(false)
  const title = member?.displayName || member?.email || fallbackId

  return (
    <span
      title={title}
      className="-ml-1 first:ml-0 inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-[var(--color-card-border)] bg-[var(--color-surface-container)] text-[9px] font-semibold leading-none text-on-surface"
    >
      {member?.photoURL && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.photoURL}
          alt=""
          className="h-full w-full rounded-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        memberInitials(member)
      )}
    </span>
  )
}

const AGENT_DEFAULT_COLOR: Record<string, string> = {
  pip: 'bg-violet-400',
  theo: 'bg-sky-400',
  maya: 'bg-amber-400',
  sage: 'bg-emerald-400',
  nora: 'bg-rose-400',
  ads: 'bg-amber-400',
  'qa-release': 'bg-emerald-400',
  support: 'bg-sky-400',
  data: 'bg-violet-400',
  docs: 'bg-rose-400',
  seo: 'bg-emerald-400',
}

const AGENT_STATUS_STYLE: Record<string, { label: string; className: string }> = {
  'pending':        { label: 'Waiting',   className: 'bg-white/10 text-on-surface-variant' },
  'picked-up':      { label: 'Picked up', className: 'bg-sky-500/20 text-sky-400' },
  'in-progress':    { label: 'Working',   className: 'bg-amber-500/20 text-amber-400' },
  'awaiting-input': { label: 'Needs you', className: 'bg-orange-500/20 text-orange-400' },
  'done':           { label: 'Done',      className: 'bg-emerald-500/20 text-emerald-400' },
  'blocked':        { label: 'Blocked',   className: 'bg-red-500/20 text-red-400' },
}

function getTaskCreatedAtMillis(task: Task): number | null {
  const date = timestampToDate(task.createdAt)
  return date ? date.getTime() : null
}

// ── Task Card ─────────────────────────────────────────────────────────────

function TaskCard({
  task,
  members,
  agents,
  onClick,
  isDragging = false,
}: {
  task: Task
  members?: TeamMember[]
  agents?: AgentMember[]
  onClick: () => void
  isDragging?: boolean
}) {
  const priority = PRIORITY_STYLES[task.priority ?? 'medium']
  const stateStyle = getTaskStateStyle(task)
  const attachmentCount = task.attachments?.length ?? 0
  const dueLabel = formatTaskDate(task.dueDate)
  const releaseLabel = task.agentReleaseStatus === 'scheduled' ? formatTaskDateTime(task.agentReleaseAt) : ''
  const startDateTimeLabel = formatTaskDateTime(task.startDate)
  const endDateTimeLabel = formatTaskDateTime(task.completedAt ?? task.agentOutput?.completedAt ?? task.endDate ?? task.dueDate)
  const kind = attachmentKind(task)
  const assigneeIds = task.assigneeIds?.length ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : []
  const peopleIds = Array.from(new Set([...assigneeIds, ...(task.mentionIds ?? [])]))
  const assignedAgent = task.assigneeAgentId ? agents?.find((agent) => agent.agentId === task.assigneeAgentId) : undefined
  const checklistDone = task.checklist?.filter((item) => item.done).length ?? 0
  const checklistTotal = task.checklist?.length ?? 0
  const blockerRecovery = buildBlockedTaskRecovery(task)

  return (
    <div
      onClick={onClick}
      data-state-tone={stateStyle.tone}
      className="pib-card cursor-pointer select-none transition-all duration-150 hover:border-[var(--color-accent-v2)]"
      style={{
        opacity: isDragging ? 0.5 : 1,
        borderLeft: `4px solid ${stateStyle.railColor}`,
        background: stateStyle.tint,
        padding: '12px',
      }}
    >
      <p className="text-sm font-medium text-on-surface mb-1 leading-snug">{task.title}</p>
      {task.description && (
        <p className="text-xs text-on-surface-variant line-clamp-2 mb-2">{task.description}</p>
      )}
      {kind === 'image' && task.attachments?.[0]?.url && (
        <div className="mt-2 mb-2 aspect-video overflow-hidden rounded border border-[var(--color-card-border)] bg-[var(--color-surface-container)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={task.attachments[0].url} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      {blockerRecovery.isBlocked && (
        <div className="mt-2 rounded border border-orange-500/25 bg-orange-500/5 p-2 text-[10px] leading-snug text-orange-100">
          <p><span className="font-semibold">Blocked:</span> {blockerRecovery.whatIsWrong}</p>
          <p className="mt-1 opacity-90"><span className="font-semibold">Unblock:</span> {blockerRecovery.whoCanUnblock}</p>
        </div>
      )}
      {releaseLabel && (
        <div className="mt-2 flex items-center gap-1.5 rounded border border-purple-500/25 bg-purple-500/10 px-2 py-1.5 text-[10px] leading-snug text-purple-200">
          <span className="material-symbols-outlined text-[13px]">schedule</span>
          <span><span className="font-semibold">Scheduled release:</span> {releaseLabel}</span>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap mt-2">
        <span
          className="text-[9px] font-label uppercase tracking-wide px-1.5 py-0.5 rounded"
          style={{ background: `${priority.color}20`, color: priority.color }}
        >
          {priority.label}
        </span>
        <span className={`text-[9px] font-label uppercase tracking-wide px-1.5 py-0.5 rounded border ${stateStyle.pillClassName}`}>
          {stateStyle.label}
        </span>
        {task.labels?.slice(0, 2).map(l => (
          <span key={l} className="text-[9px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">
            {l}
          </span>
        ))}
      </div>
      {(startDateTimeLabel || endDateTimeLabel) && (
        <div className="mt-3 grid gap-1 text-[10px] text-on-surface-variant">
          {startDateTimeLabel && (
            <div className="flex items-center justify-between gap-2">
              <span className="font-label uppercase tracking-wide">Start</span>
              <span className="text-right text-on-surface">{startDateTimeLabel}</span>
            </div>
          )}
          {endDateTimeLabel && (
            <div className="flex items-center justify-between gap-2">
              <span className="font-label uppercase tracking-wide">End</span>
              <span className="text-right text-on-surface">{endDateTimeLabel}</span>
            </div>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-on-surface-variant">
        <div className="flex items-center gap-2 min-w-0">
          {dueLabel && (
            <span className={`inline-flex items-center gap-1 ${isDueSoon(task.dueDate) ? 'text-[var(--color-accent-v2)]' : ''}`}>
              <span className="material-symbols-outlined text-[14px]">event</span>
              {dueLabel}
            </span>
          )}
          {checklistTotal > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">checklist</span>
              {checklistDone}/{checklistTotal}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {attachmentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">
                {kind === 'video' ? 'movie' : kind === 'image' ? 'image' : 'attach_file'}
              </span>
              {attachmentCount}
            </span>
          )}
          {peopleIds.slice(0, 3).map((id) => (
            <MemberAvatar key={id} member={findMember(members, id)} fallbackId={id} />
          ))}
          {peopleIds.length > 3 && <span>+{peopleIds.length - 3}</span>}
          {task.assigneeAgentId && (
            <span className="inline-flex items-center gap-1.5">
              <span
                title={assignedAgent?.name || task.assigneeAgentId}
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-card-border)] text-white ${AGENT_DEFAULT_COLOR[task.assigneeAgentId] ?? 'bg-white/40'}`}
              >
                <span className="material-symbols-outlined block text-[13px] leading-none">{assignedAgent?.iconKey ?? 'smart_toy'}</span>
              </span>
              {task.agentStatus && AGENT_STATUS_STYLE[task.agentStatus] && (
                <span className={`text-[9px] font-label uppercase tracking-wide px-1.5 py-0.5 rounded ${AGENT_STATUS_STYLE[task.agentStatus].className}`}>
                  {AGENT_STATUS_STYLE[task.agentStatus].label}
                </span>
              )}
              {task.agentEffort && (
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-label uppercase tracking-wide text-on-surface-variant">
                  {task.agentEffort}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sortable Task Card ────────────────────────────────────────────────────

function SortableTaskCard({ task, members, agents, onClick }: { task: Task; members?: TeamMember[]; agents?: AgentMember[]; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} members={members} agents={agents} onClick={onClick} isDragging={isDragging} />
    </div>
  )
}

// ── Kanban Column ─────────────────────────────────────────────────────────

function KanbanColumn({
  column,
  tasks,
  members,
  agents,
  onTaskClick,
  onAddTask,
}: {
  column: Column
  tasks: Task[]
  members?: TeamMember[]
  agents?: AgentMember[]
  onTaskClick: (task: Task) => void
  onAddTask: () => void
}) {
  const taskIds = tasks.map(t => t.id)
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <div className="flex flex-col w-72 shrink-0">
      {/* Column header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: column.color || 'var(--color-accent-v2)' }} />
          <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">
            {column.name}
          </span>
          <span
            className="text-[9px] font-label px-1.5 py-0.5 rounded-full"
            style={{ background: 'var(--color-surface-container)', color: 'var(--color-on-surface-variant)' }}
          >
            {tasks.length}
          </span>
        </div>
        <button
          onClick={onAddTask}
          className="text-on-surface-variant hover:text-on-surface transition-colors text-lg leading-none"
          title="Add task"
        >
          +
        </button>
      </div>

      {/* Task drop zone */}
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex flex-col gap-2 min-h-24 flex-1 rounded-lg transition-colors"
          style={isOver ? { background: 'color-mix(in oklab, var(--color-accent-v2) 8%, transparent)' } : undefined}
        >
          {tasks.map(task => (
            <SortableTaskCard key={task.id} task={task} members={members} agents={agents} onClick={() => onTaskClick(task)} />
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

// ── Main Board ────────────────────────────────────────────────────────────

export function KanbanBoard({
  columns,
  tasks: initialTasks,
  members,
  agents,
  sortMode: controlledSortMode,
  onSortModeChange,
  showSortToggle = true,
  onTaskMove,
  onTaskClick,
  onAddTask,
}: KanbanBoardProps) {
  const [tasks, setTasks] = useState(initialTasks)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [internalSortMode, setInternalSortMode] = useState<'latest' | 'manual'>('latest')
  const sortMode = controlledSortMode ?? internalSortMode

  useEffect(() => {
    setTasks(initialTasks)
  }, [initialTasks])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const sortedColumns = [...columns].sort((a, b) => a.order - b.order)

  function handleSortModeToggle() {
    const nextMode = sortMode === 'latest' ? 'manual' : 'latest'
    if (onSortModeChange) {
      onSortModeChange(nextMode)
    } else {
      setInternalSortMode(nextMode)
    }
  }

  const getTasksForColumn = useCallback(
    (columnId: string) =>
      tasks
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

    const activeTask = tasks.find(t => t.id === active.id)
    if (!activeTask) return

    // Determine target column
    const overTask = tasks.find(t => t.id === over.id)
    const overColumn = columns.find(c => c.id === over.id)
    const targetColumnId = overTask ? overTask.columnId : overColumn ? overColumn.id : activeTask.columnId

    if (activeTask.columnId !== targetColumnId) {
      setTasks(prev => prev.map(t =>
        t.id === active.id ? { ...t, columnId: targetColumnId } : t
      ))
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveTask(null)
    if (!over) return

    const movedTask = tasks.find(t => t.id === active.id)
    if (!movedTask) return

    const overTask = tasks.find(t => t.id === over.id)
    const overColumn = columns.find(c => c.id === over.id)
    const targetColumnId = overTask ? overTask.columnId : overColumn ? overColumn.id : movedTask.columnId
    const columnTasks = tasks
      .filter(t => t.columnId === targetColumnId && t.id !== movedTask.id)
      .sort((a, b) => a.order - b.order)
    const targetIndex = overTask ? Math.max(0, columnTasks.findIndex(t => t.id === overTask.id)) : columnTasks.length
    const previousOrder = targetIndex > 0 ? columnTasks[targetIndex - 1]?.order : undefined
    const nextOrder = columnTasks[targetIndex]?.order
    const newOrder =
      typeof previousOrder === 'number' && typeof nextOrder === 'number'
        ? (previousOrder + nextOrder) / 2
        : typeof nextOrder === 'number'
          ? nextOrder - 1
          : typeof previousOrder === 'number'
            ? previousOrder + 1
            : Date.now()

    setTasks(prev => prev.map(t =>
      t.id === active.id ? { ...t, columnId: targetColumnId, order: newOrder } : t
    ))
    await onTaskMove(movedTask.id, targetColumnId, newOrder)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {showSortToggle && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={handleSortModeToggle}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-card-border)] px-3 py-1.5 text-xs font-label uppercase tracking-wide text-on-surface-variant transition-colors hover:text-on-surface"
            aria-pressed={sortMode === 'manual'}
          >
            <span className="material-symbols-outlined text-[16px]">sort</span>
            {sortMode === 'latest' ? 'Manual order' : 'Latest first'}
          </button>
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 500 }}>
        {sortedColumns.map(column => (
          <KanbanColumn
            key={column.id}
            column={column}
            tasks={getTasksForColumn(column.id)}
            members={members}
            agents={agents}
            onTaskClick={onTaskClick}
            onAddTask={() => onAddTask(column.id)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} members={members} agents={agents} onClick={() => {}} /> : null}
      </DragOverlay>
    </DndContext>
  )
}
