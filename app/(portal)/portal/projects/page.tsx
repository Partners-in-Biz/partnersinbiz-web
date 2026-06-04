'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { getClientDb } from '@/lib/firebase/config'
import { CrossProjectBoard } from '@/components/projects/CrossProjectBoard'
import { ProjectListCard } from '@/components/projects/ProjectListCard'
import { ProjectPortfolioReportPanel } from '@/components/projects/ProjectPortfolioReportPanel'
import { EmptyState, PageHeader, PageTabs, Surface } from '@/components/ui/AppFoundation'
import type { BoardTask } from '@/components/projects/CrossProjectBoard'

type ProjectView = 'active' | 'archive'

interface Project {
  id: string
  name: string
  status: string
  description?: string
  createdAt?: unknown
  updatedAt?: unknown
  archived?: boolean
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
const WORKSPACE_TABS = [
  { value: 'portfolio', label: 'Portfolio report', icon: 'monitoring' },
  { value: 'projects', label: 'Projects', icon: 'folder_managed' },
]
const PROJECT_VIEW_TABS = [
  { value: 'active', label: 'Active' },
  { value: 'archive', label: 'Archive' },
]

function receivedProjectsUrl(projectView: ProjectView = 'active') {
  const archiveQuery = projectView === 'archive' ? '&archive=only' : ''
  return `/api/v1/projects?view=received${archiveQuery}`
}

function isHistoricalProject(project: Project): boolean {
  return project.archived === true || project.status?.trim().toLowerCase() === 'completed'
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
  const [activeSection, setActiveSection] = useState<'portfolio' | 'projects'>('projects')
  const [projectView, setProjectView] = useState<ProjectView>('active')
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
    fetch(receivedProjectsUrl(projectView))
      .then(r => r.json())
      .then(body => { setProjects(body.data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [projectView])

  useEffect(() => {
    setFilter('all')
  }, [projectView])

  const filtered = useMemo(
    () => filter === 'all' ? projects : projects.filter(p => p.status === filter),
    [projects, filter],
  )

  useEffect(() => {
    if (activeSection !== 'projects' || viewMode !== 'board') return
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
  }, [activeSection, viewMode, filtered])

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
      const listRes = await fetch(receivedProjectsUrl(projectView))
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
          <>
            <PageTabs
              ariaLabel="Project workspace sections"
              value={activeSection}
              onValueChange={(value) => setActiveSection(value as 'portfolio' | 'projects')}
              tabs={WORKSPACE_TABS}
            />
            <button
              onClick={() => setShowForm(true)}
              className="pib-btn-primary text-sm font-label"
            >
              Request project
            </button>
          </>
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

      {activeSection === 'portfolio' ? (
        <ProjectPortfolioReportPanel />
      ) : null}

      {activeSection === 'projects' ? (
        <>
          {/* Filters and view controls */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex min-w-0 flex-wrap items-center gap-2 overflow-x-auto">
              <PageTabs
                ariaLabel="Project archive filters"
                value={projectView}
                onValueChange={(value) => setProjectView(value as ProjectView)}
                tabs={PROJECT_VIEW_TABS}
              />
              <PageTabs
                value={filter}
                onValueChange={setFilter}
                ariaLabel="Project status filter"
                tabs={PROJECT_STAGE_TABS}
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
          ) : loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
            </div>
          ) : projectView === 'archive' ? (
            <>
              <p className="text-sm text-on-surface-variant">Completed and archived project history.</p>
              {filtered.length === 0 ? (
                <EmptyState
                  icon="archive"
                  title="No archived projects found."
                  description="Completed and archived projects will appear here after sign-off."
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filtered.map(project => <ProjectListCard key={project.id} project={project} href={`/portal/projects/${project.id}`} />)}
                </div>
              )}
            </>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="rocket_launch"
              title="No projects found."
              description={projectView === 'archive' ? 'Completed and archived project history will appear here after sign-off.' : filter === 'all' ? 'Projects will appear here once work has been opened for your workspace.' : 'Try a different status filter to see more projects.'}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map(project => (
                <div key={project.id} className="relative group">
                  <ProjectListCard project={project} href={`/portal/projects/${project.id}`} />
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
