'use client'

import { useEffect, useRef, useState } from 'react'

interface DocumentTask {
  id: string
  documentId: string
  orgId: string
  title: string
  completed: boolean
  createdAt: unknown
  createdBy: string
}

interface Props {
  documentId: string
}

export function DocumentTaskList({ documentId }: Props) {
  const [tasks, setTasks] = useState<DocumentTask[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title || adding) return
    setAdding(true)
    try {
      const res = await fetch(`/api/v1/client-documents/${documentId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (res.ok) {
        setNewTitle('')
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
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, completed: next } : t)),
    )
    try {
      await fetch(`/api/v1/client-documents/${documentId}/tasks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, completed: next }),
      })
    } catch {
      // Revert on failure
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, completed: task.completed } : t)),
      )
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
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Task title…"
            className="flex-1 rounded-md border border-[var(--color-pib-line)] bg-white/5 px-2.5 py-1.5 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]"
          />
          <button
            type="submit"
            disabled={!newTitle.trim() || adding}
            className="rounded-md border border-[var(--color-pib-line)] px-2.5 py-1.5 text-xs font-medium hover:bg-white/5 disabled:opacity-50"
          >
            {adding ? '…' : 'Add'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="space-y-2">
          <div className="h-4 rounded bg-white/5 animate-pulse" />
          <div className="h-4 rounded bg-white/5 animate-pulse w-3/4" />
        </div>
      ) : tasks.length === 0 ? (
        <p className="text-xs text-[var(--color-pib-text-muted)]">No action items yet.</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-start gap-2">
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
              <span
                className={`text-xs leading-5 ${
                  task.completed
                    ? 'line-through text-[var(--color-pib-text-muted)]'
                    : 'text-[var(--color-pib-text)]'
                }`}
              >
                {task.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
