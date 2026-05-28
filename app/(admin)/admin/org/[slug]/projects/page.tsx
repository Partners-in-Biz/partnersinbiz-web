'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { getClientDb } from '@/lib/firebase/config'
import { CrossProjectBoard } from '@/components/projects/CrossProjectBoard'
import { ProjectListCard } from '@/components/projects/ProjectListCard'
import { ProjectPortfolioReportPanel } from '@/components/projects/ProjectPortfolioReportPanel'
import { PageHeader, PageTabs, Surface } from '@/components/ui/AppFoundation'
import type { BoardTask } from '@/components/projects/CrossProjectBoard'

interface Project {
  id: string
  orgId?: string
  name: string
  status: string
  description?: string
  createdAt?: unknown
  updatedAt?: unknown
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

const STATUS_OPTIONS = ['discovery', 'design', 'development', 'review', 'live', 'maintenance']
const PROJECT_STAGE_TABS = [
  { value: 'all', label: 'All' },
  ...STATUS_OPTIONS.map((status) => ({
    value: status,
    label: status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
  })),
]
const PROJECT_REFRESH_INTERVAL_MS = 10000

function receivedProjectsUrl(slug: string) {
  return `/api/v1/projects?view=received&orgSlug=${encodeURIComponent(slug)}`
}

function mergeLiveTasks(restTasks: BoardTask[], currentTasks: BoardTask[]) {
  const merged = new Map<string, BoardTask>()
  restTasks.forEach(task => merged.set(task.id, task))
  currentTasks.forEach(task => merged.set(task.id, task))
  return Array.from(merged.values())
}

export default function ProjectsPage() {
  const params = useParams()
  const slug = params.slug as string
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list')
  const [boardSortMode, setBoardSortMode] = useState<'latest' | 'manual'>('latest')
  const [boardTasks, setBoardTasks] = useState<BoardTask[]>([])
  const [boardLoading, setBoardLoading] = useState(false)
  const [failedProjectIds, setFailedProjectIds] = useState<string[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  // New project form state
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formStatus, setFormStatus] = useState('discovery')
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const loadProjects = useCallback(async ({ showSpinner = false }: { showSpinner?: boolean } = {}) => {
    if (showSpinner) setLoading(true)
    try {
      const res = await fetch(receivedProjectsUrl(slug))
      const body = await res.json()
      setProjects(body.data ?? [])
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    let cancelled = false
    const refresh = async (options?: { showSpinner?: boolean }) => {
      if (cancelled) return
      await loadProjects(options)
    }

    refresh({ showSpinner: true }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    const interval = window.setInterval(() => {
      refresh().catch(() => {})
    }, PROJECT_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [loadProjects])

  const liveOrgId = useMemo(() => projects.find(project => project.orgId)?.orgId, [projects])

  useEffect(() => {
    if (!liveOrgId) return
    const unsubscribe = onSnapshot(
      query(collection(getClientDb(), 'projects'), where('orgId', '==', liveOrgId)),
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
  }, [liveOrgId])

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
          orgSlug: slug,
          status: formStatus,
        }),
      })

      const body = await res.json()

      if (!res.ok) {
        throw new Error(body.error || 'Failed to create project')
      }

      // Refetch the full list so the new project is confirmed from the server
      const listRes = await fetch(receivedProjectsUrl(slug))
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

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/v1/projects?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Failed to delete project')
      }
      setProjects(prev => prev.filter(p => p.id !== id))
    } catch (err) {
      console.error(err)
    } finally {
      setDeletingId(null)
      setConfirmId(null)
    }
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
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Workspace / Projects"
        title="Projects"
        description="Kanban-led delivery spaces for client and platform work. Switch between board and list views without leaving the workspace."
        actions={!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="pib-btn-primary text-sm font-label"
          >
            + New Project
          </button>
        ) : null}
      />

      {/* New Project Form */}
      {showForm && (
        <Surface className="p-4">
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

      <ProjectPortfolioReportPanel reportUrl={`/api/v1/projects/reporting?orgSlug=${encodeURIComponent(slug)}`} />

      {/* Filters and view controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <PageTabs
          ariaLabel="Project stage filters"
          value={filter}
          onValueChange={setFilter}
          tabs={PROJECT_STAGE_TABS}
        />

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
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-card-border)] bg-[var(--color-card)] px-6 py-12 text-center">
          <span className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
            <span className="material-symbols-outlined block text-[22px] leading-none">folder_managed</span>
          </span>
          <p className="font-medium text-on-surface">No projects found</p>
          <p className="mt-1 text-sm text-on-surface-variant">Try another stage filter or create a new client project.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(project => (
            <div key={project.id} className="relative group">
              <ProjectListCard project={project} href={`/admin/org/${slug}/projects/${project.id}`} />

              {/* Delete button — appears on hover */}
              {confirmId === project.id ? (
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-[var(--color-surface)] border border-[#ef4444] rounded-md px-2 py-1 shadow-sm z-10">
                  <span className="text-[11px] text-[#ef4444]">Delete?</span>
                  <button
                    onClick={() => handleDelete(project.id)}
                    disabled={deletingId === project.id}
                    className="text-[11px] font-medium text-[#ef4444] hover:underline disabled:opacity-50"
                  >
                    {deletingId === project.id ? '…' : 'Yes'}
                  </button>
                  <span className="text-[11px] text-on-surface-variant">/</span>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="text-[11px] text-on-surface-variant hover:text-on-surface"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => { e.preventDefault(); setConfirmId(project.id) }}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[#ef444420] text-[#ef4444]"
                  title="Delete project"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
