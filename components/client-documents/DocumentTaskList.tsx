'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

interface DocumentTask {
  id: string
  documentId: string
  orgId: string
  title: string
  completed: boolean
  /** Free-text assignee (name or email). */
  assignee?: string
  /** ISO date string (yyyy-mm-dd). */
  dueDate?: string
  createdAt: unknown
  createdBy: string
  updatedAt?: unknown
  updatedBy?: string
}

interface Props {
  documentId: string
}

type DueFilter = 'all' | 'overdue' | 'due_soon' | 'no_due'
type CompletedFilter = 'all' | 'active' | 'completed'

/** Local yyyy-mm-dd for "today" so date comparisons are timezone-stable. */
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Add `days` to a yyyy-mm-dd string, returning a new yyyy-mm-dd string. */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function isOverdue(task: DocumentTask, today: string): boolean {
  return !task.completed && !!task.dueDate && task.dueDate < today
}

/** Friendly short due-date label, e.g. "12 Jun". */
function formatDue(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function DocumentTaskList({ documentId }: Props) {
  const [tasks, setTasks] = useState<DocumentTask[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [adding, setAdding] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Filters
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const [dueFilter, setDueFilter] = useState<DueFilter>('all')
  const [completedFilter, setCompletedFilter] = useState<CompletedFilter>('all')

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editAssignee, setEditAssignee] = useState('')
  const [editDueDate, setEditDueDate] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const today = todayIso()

  async function fetchTasks() {
    try {
      const res = await fetch(`/api/v1/client-documents/${documentId}/tasks`)
      if (!res.ok) return
      const body = await res.json()
      setTasks((body.data ?? []) as DocumentTask[])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId])

  useEffect(() => {
    if (showInput) inputRef.current?.focus()
  }, [showInput])

  const distinctAssignees = useMemo(() => {
    const set = new Set<string>()
    for (const t of tasks) {
      if (t.assignee && t.assignee.trim()) set.add(t.assignee.trim())
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [tasks])

  const filteredTasks = useMemo(() => {
    const soonCutoff = addDaysIso(today, 7)
    return tasks.filter((t) => {
      // Completed filter
      if (completedFilter === 'active' && t.completed) return false
      if (completedFilter === 'completed' && !t.completed) return false

      // Assignee filter
      if (assigneeFilter !== 'all') {
        if ((t.assignee ?? '').trim() !== assigneeFilter) return false
      }

      // Due filter
      if (dueFilter === 'overdue') {
        if (!isOverdue(t, today)) return false
      } else if (dueFilter === 'due_soon') {
        if (!t.dueDate || t.dueDate < today || t.dueDate > soonCutoff) return false
      } else if (dueFilter === 'no_due') {
        if (t.dueDate) return false
      }

      return true
    })
  }, [tasks, completedFilter, assigneeFilter, dueFilter, today])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title || adding) return
    setAdding(true)
    try {
      const payload: Record<string, unknown> = { title }
      if (newAssignee.trim()) payload.assignee = newAssignee.trim()
      if (newDueDate) payload.dueDate = newDueDate
      const res = await fetch(`/api/v1/client-documents/${documentId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setNewTitle('')
        setNewAssignee('')
        setNewDueDate('')
        setShowInput(false)
        await fetchTasks()
      }
    } finally {
      setAdding(false)
    }
  }

  async function handleToggle(task: DocumentTask) {
    const next = !task.completed
    // Optimistic update
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: next } : t)))
    try {
      await fetch(`/api/v1/client-documents/${documentId}/tasks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, completed: next }),
      })
    } catch {
      // Revert on failure
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: task.completed } : t)))
    }
  }

  function startEdit(task: DocumentTask) {
    setEditingId(task.id)
    setEditTitle(task.title)
    setEditAssignee(task.assignee ?? '')
    setEditDueDate(task.dueDate ?? '')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditTitle('')
    setEditAssignee('')
    setEditDueDate('')
  }

  async function handleSaveEdit(e: React.FormEvent, task: DocumentTask) {
    e.preventDefault()
    const title = editTitle.trim()
    if (!title || savingEdit) return
    setSavingEdit(true)

    const nextAssignee = editAssignee.trim()
    const nextDueDate = editDueDate
    try {
      const res = await fetch(`/api/v1/client-documents/${documentId}/tasks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          title,
          // Send empty string to clear (API treats '' as delete).
          assignee: nextAssignee,
          dueDate: nextDueDate,
        }),
      })
      if (res.ok) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  title,
                  assignee: nextAssignee || undefined,
                  dueDate: nextDueDate || undefined,
                }
              : t,
          ),
        )
        cancelEdit()
      }
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <section className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-pib-text-muted)]">
          Action items
        </h3>
        <button
          type="button"
          onClick={() => setShowInput((v) => !v)}
          className="flex items-center gap-1 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
          aria-label="Add task"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Add
        </button>
      </div>

      {showInput && (
        <form onSubmit={handleAdd} className="space-y-2">
          <input
            ref={inputRef}
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Task title…"
            className="w-full rounded-md border border-[var(--color-pib-line)] bg-white/5 px-2.5 py-1.5 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value)}
              placeholder="Assignee (optional)"
              className="flex-1 rounded-md border border-[var(--color-pib-line)] bg-white/5 px-2.5 py-1.5 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
            />
            <input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              aria-label="Due date"
              className="rounded-md border border-[var(--color-pib-line)] bg-white/5 px-2.5 py-1.5 text-xs text-[var(--color-pib-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!newTitle.trim() || adding}
              className="rounded-md border border-[var(--color-pib-line)] px-2.5 py-1.5 text-xs font-medium hover:bg-white/5 disabled:opacity-50"
            >
              {adding ? '…' : 'Add task'}
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      {!loading && tasks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            aria-label="Filter by assignee"
            className="rounded-md border border-[var(--color-pib-line)] bg-white/5 px-2 py-1 text-[11px] text-[var(--color-pib-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          >
            <option value="all">All assignees</option>
            {distinctAssignees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            value={dueFilter}
            onChange={(e) => setDueFilter(e.target.value as DueFilter)}
            aria-label="Filter by due date"
            className="rounded-md border border-[var(--color-pib-line)] bg-white/5 px-2 py-1 text-[11px] text-[var(--color-pib-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          >
            <option value="all">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="due_soon">Due soon (7 days)</option>
            <option value="no_due">No due date</option>
          </select>
          <select
            value={completedFilter}
            onChange={(e) => setCompletedFilter(e.target.value as CompletedFilter)}
            aria-label="Filter by status"
            className="rounded-md border border-[var(--color-pib-line)] bg-white/5 px-2 py-1 text-[11px] text-[var(--color-pib-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          <div className="h-4 rounded bg-white/5 animate-pulse" />
          <div className="h-4 rounded bg-white/5 animate-pulse w-3/4" />
        </div>
      ) : tasks.length === 0 ? (
        <p className="text-xs text-[var(--color-pib-text-muted)]">No action items yet.</p>
      ) : filteredTasks.length === 0 ? (
        <p className="text-xs text-[var(--color-pib-text-muted)]">No tasks match the current filters.</p>
      ) : (
        <ul className="space-y-2">
          {filteredTasks.map((task) => {
            const overdue = isOverdue(task, today)
            if (editingId === task.id) {
              return (
                <li
                  key={task.id}
                  className="rounded-md border border-[var(--color-pib-line)] bg-white/5 p-2 space-y-2"
                >
                  <form onSubmit={(e) => handleSaveEdit(e, task)} className="space-y-2">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Task title…"
                      className="w-full rounded-md border border-[var(--color-pib-line)] bg-white/5 px-2.5 py-1.5 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editAssignee}
                        onChange={(e) => setEditAssignee(e.target.value)}
                        placeholder="Assignee"
                        className="flex-1 rounded-md border border-[var(--color-pib-line)] bg-white/5 px-2.5 py-1.5 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
                      />
                      <input
                        type="date"
                        value={editDueDate}
                        onChange={(e) => setEditDueDate(e.target.value)}
                        aria-label="Due date"
                        className="rounded-md border border-[var(--color-pib-line)] bg-white/5 px-2.5 py-1.5 text-xs text-[var(--color-pib-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-md border border-[var(--color-pib-line)] px-2.5 py-1 text-[11px] font-medium hover:bg-white/5"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!editTitle.trim() || savingEdit}
                        className="rounded-md border border-[var(--color-pib-line)] px-2.5 py-1 text-[11px] font-medium hover:bg-white/5 disabled:opacity-50"
                      >
                        {savingEdit ? '…' : 'Save'}
                      </button>
                    </div>
                  </form>
                </li>
              )
            }

            return (
              <li
                key={task.id}
                className={`group flex items-start gap-2 rounded-md px-1.5 py-1 ${
                  overdue ? 'border border-red-500/30 bg-red-500/5' : 'border border-transparent'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleToggle(task)}
                  aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
                  className="mt-0.5 flex-shrink-0 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-accent)] transition-colors"
                >
                  <span className="material-symbols-outlined text-base">
                    {task.completed ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <span
                    className={`block text-xs leading-5 ${
                      task.completed
                        ? 'line-through text-[var(--color-pib-text-muted)]'
                        : 'text-[var(--color-pib-text)]'
                    }`}
                  >
                    {task.title}
                  </span>
                  {(task.assignee || task.dueDate) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                      {task.assignee && (
                        <span className="inline-flex items-center gap-0.5 text-[var(--color-pib-text-muted)]">
                          <span className="material-symbols-outlined text-xs">person</span>
                          {task.assignee}
                        </span>
                      )}
                      {task.dueDate && (
                        <span
                          className={`inline-flex items-center gap-0.5 ${
                            overdue ? 'text-red-300' : 'text-[var(--color-pib-text-muted)]'
                          }`}
                        >
                          <span className="material-symbols-outlined text-xs">event</span>
                          {formatDue(task.dueDate)}
                          {overdue && <span className="font-medium">· Overdue</span>}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(task)}
                  aria-label="Edit task"
                  className="mt-0.5 flex-shrink-0 text-[var(--color-pib-text-muted)] opacity-0 transition-opacity hover:text-[var(--color-pib-text)] group-hover:opacity-100"
                >
                  <span className="material-symbols-outlined text-sm">edit</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
