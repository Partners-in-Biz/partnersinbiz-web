'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { collection, onSnapshot } from 'firebase/firestore'
import { getClientDb } from '@/lib/firebase/config'
import { CrossProjectBoard } from '@/components/projects/CrossProjectBoard'
import { EmptyState, PageHeader, PageTabs, Surface } from '@/components/ui/AppFoundation'
import type { BoardTask } from '@/components/projects/CrossProjectBoard'

interface Project {
  id: string
  name: string
  status: string
  description?: string
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

const STATUS_OPTIONS = ['discovery', 'design', 'development', 'review', 'live', 'maintenance']

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    active:      { label: 'Active',      color: 'var(--color-accent-v2)' },
    on_hold:     { label: 'On Hold',     color: 'var(--color-secondary)' },
    completed:   { label: 'Completed',   color: '#4ade80' },
    archived:    { label: 'Archived',    color: 'var(--color-outline)' },
    in_progress: { label: 'In Progress', color: 'var(--color-accent-v2)' },
  }
  const s = map[status] ?? { label: status, color: 'var(--color-outline)' }
  return (
    <span
      className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: `${s.color}20`, color: s.color }}
    >
      {s.label}
    </span>
  )
}

function mergeLiveTasks(restTasks: BoardTask[], currentTasks: BoardTask[]) {
  const merged = new Map<string, BoardTask>()
  restTasks.forEach(task => merged.set(task.id, task))
  currentTasks.forEach(task => merged.set(task.id, task))
  return Array.from(merged.values())
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  const [viewMode, setViewMode]                 = useState<'list' | 'board'>('list')
  const [boardSortMode, setBoardSortMode]       = useState<'latest' | 'manual'>('latest')
  const [boardTasks, setBoardTasks]             = useState<BoardTask[]>([])
  const [boardLoading, setBoardLoading]         = useState(false)
  const [failedProjectIds, setFailedProjectIds] = useState<string[]>([])

  // New project form state
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formStatus, setFormStatus] = useState('discovery')
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/projects')
      .then(r => r.json())
      .then(body => { setProjects(body.data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(getClientDb(), 'projects'),
      (snap) => {
        snap.docChanges().forEach(change => {
          if (change.type === 'removed') {
            setProjects(prev => prev.filter(project => project.id !== change.doc.id))
            return
          }

          const liveProject = { id: change.doc.id, ...change.doc.data() } as Project
          setProjects(prev => {
            const idx = prev.findIndex(project => project.id === liveProject.id)
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = { ...next[idx], ...liveProject }
              return next
            }
            return [liveProject, ...prev]
          })
        })
      },
      () => {} // REST remains the fallback if client Firestore auth/listening fails.
    )
    return () => unsubscribe()
  }, [])

  const filtered = useMemo(
    () => filter === 'all' ? projects : projects.filter(p => p.status === filter),
    [projects, filter],
  )

  useEffect(() => {
    if (viewMode !== 'board') return
    if (filtered.length === 0) {
      setBoardTasks([])
      setFailedProjectIds([])
      setBoardLoading(false)
      return
    }

    let cancelled = false
    const unsubscribers: Array<() => void> = []
    setBoardLoading(true)
    setFailedProjectIds([])

    for (const project of filtered) {
      const unsubscribe = onSnapshot(
        collection(getClientDb(), 'projects', project.id, 'tasks'),
        (snap) => {
          snap.docChanges().forEach(change => {
            if (cancelled) return
            const liveTask = {
              id: change.doc.id,
              ...change.doc.data(),
              projectId: project.id,
              projectName: project.name,
            } as BoardTask

            if (change.type === 'removed') {
              setBoardTasks(prev => prev.filter(task => task.id !== change.doc.id))
              return
            }

            setBoardTasks(prev => {
              const idx = prev.findIndex(task => task.id === liveTask.id)
              if (idx >= 0) {
                const next = [...prev]
                next[idx] = liveTask
                return next
              }
              return [...prev, liveTask]
            })
          })
        },
        () => {} // REST remains the fallback if client Firestore auth/listening fails.
      )
      unsubscribers.push(unsubscribe)
    }

    const fetches = filtered.map(project =>
      fetch(`/api/v1/projects/${project.id}/tasks`)
        .then(r => r.json())
        .then((body): { project: Project; tasks: BoardTask[] } => ({
          project,
          tasks: (body.data ?? []).map((t: BoardTask) => ({
            ...t,
            projectId: project.id,
            projectName: project.name,
          })),
        }))
        .catch(() => ({ project, tasks: undefined as BoardTask[] | undefined }))
    )

    Promise.all(fetches).then(results => {
      if (cancelled) return
      const failed: string[] = []
      const all: BoardTask[] = []
      for (const { project, tasks } of results) {
        if (!tasks) {
          failed.push(project.id)
        } else {
          all.push(...tasks)
        }
      }
      setBoardTasks(prev => mergeLiveTasks(all, prev))
      setFailedProjectIds(failed)
      setBoardLoading(false)
    })

    return () => {
      cancelled = true
      unsubscribers.forEach(unsubscribe => unsubscribe())
    }
  }, [viewMode, filtered])

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) return

    try {
      setFormError(null)
      setFormLoading(true)

      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          status: formStatus,
        }),
      })

      const body = await res.json()

      if (!res.ok) {
        throw new Error(body.error || 'Failed to create project')
      }

      // Refetch the full list so the new project is confirmed from the server
      const listRes = await fetch('/api/v1/projects')
      const listBody = await listRes.json()
      setProjects(listBody.data ?? [])
      setShowForm(false)
      setFormName('')
      setFormStatus('discovery')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setFormLoading(false)
    }
  }

  const handleCancel = () => {
    setShowForm(false)
    setFormName('')
    setFormStatus('discovery')
    setFormError(null)
  }

  const handleBoardTaskUpdate = useCallback(
    (projectId: string, taskId: string, patch: Partial<{ columnId: string; order: number }>) => {
      setBoardTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t))
      fetch(`/api/v1/projects/${projectId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).catch(() => {
        setBoardTasks(prev => prev.map(t => t.id === taskId ? { ...t, columnId: t.columnId, order: t.order } : t))
      })
    },
    [],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Client workspace / Projects"
        title="Projects"
        description="Follow active work, timelines, and task progress without exposing internal admin controls."
        actions={showForm ? null : (
          <button
            onClick={() => setShowForm(true)}
            className="pib-btn-primary text-sm font-label"
          >
            Request project
          </button>
        )}
      />

      {/* New Project Form */}
      {showForm && (
        <Surface>
          <form onSubmit={handleCreateProject} className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[150px]">
              <input
                type="text"
                placeholder="Project name…"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full px-3 py-2 rounded-md text-sm"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}
                disabled={formLoading}
                autoFocus
              />
            </div>
            <select
              value={formStatus}
              onChange={(e) => setFormStatus(e.target.value)}
              className="px-3 py-2 rounded-md text-sm"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-outline)' }}
              disabled={formLoading}
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <button
              type="submit"
              className="pib-btn-primary text-sm font-label"
              disabled={formLoading || !formName.trim()}
            >
              {formLoading ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="pib-btn-secondary text-sm font-label"
              disabled={formLoading}
            >
              Cancel
            </button>
          </form>
          {formError && (
            <p className="text-xs text-[#ef4444] mt-2">{formError}</p>
          )}
        </Surface>
      )}

      {/* Filters and view controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 overflow-x-auto">
          <PageTabs
            variant="segmented"
            value={filter}
            onValueChange={setFilter}
            ariaLabel="Project status filter"
            tabs={['all', ...STATUS_OPTIONS].map(s => ({
              value: s,
              label: s === 'all' ? 'All' : s.replace(/_/g, ' '),
            }))}
          />
        </div>

        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
          <div
            className="flex rounded-[var(--radius-btn)] overflow-hidden border"
            style={{ borderColor: 'var(--color-outline)' }}
          >
            {(['list', 'board'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-label capitalize transition-colors"
                style={
                  viewMode === mode
                    ? { background: 'var(--color-accent-v2)', color: '#000' }
                    : { background: 'transparent', color: 'var(--color-on-surface-variant)' }
                }
              >
                <span className="material-symbols-outlined text-[14px]">
                  {mode === 'list' ? 'list' : 'view_kanban'}
                </span>
                {mode}
              </button>
            ))}
          </div>
          {viewMode === 'board' && !boardLoading && boardTasks.length > 0 && (
            <button
              type="button"
              onClick={() => setBoardSortMode(prev => prev === 'latest' ? 'manual' : 'latest')}
              className="inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-btn)] border border-[var(--color-card-border)] px-3 py-1.5 text-xs font-label uppercase tracking-wide text-on-surface-variant transition-colors hover:text-on-surface"
              aria-pressed={boardSortMode === 'manual'}
            >
              <span className="material-symbols-outlined text-[16px]">sort</span>
              {boardSortMode === 'latest' ? 'Manual order' : 'Latest first'}
            </button>
          )}
        </div>
      </div>

      {/* Error banner for partial board load failures */}
      {viewMode === 'board' && failedProjectIds.length > 0 && (
        <div
          className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] px-4 py-2 text-sm"
          style={{ background: '#ef444420', color: '#f87171', border: '1px solid #ef444430' }}
        >
          <span>Could not load tasks for {failedProjectIds.length} project(s).</span>
          <button
            onClick={() => {
              setViewMode('list')
              setTimeout(() => setViewMode('board'), 0)
            }}
            className="underline text-xs shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {viewMode === 'board' ? (
        <CrossProjectBoard
          tasks={boardTasks}
          loading={boardLoading}
          sortMode={boardSortMode}
          onTaskUpdate={handleBoardTaskUpdate}
        />
      ) : (
        loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="rocket_launch"
            title="No projects found."
            description={filter === 'all' ? 'Projects will appear here once work has been opened for your workspace.' : 'Try a different status filter to see more projects.'}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map(project => (
              <div key={project.id} className="relative group">
                <Link
                  href={`/portal/projects/${project.id}`}
                  className="pib-card pib-card-hover block"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="font-medium text-on-surface pr-6">{project.name}</h3>
                    <StatusBadge status={project.status} />
                  </div>
                  {project.description && (
                    <p className="text-sm text-on-surface-variant line-clamp-2">{project.description}</p>
                  )}
                </Link>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
