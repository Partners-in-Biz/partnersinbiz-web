'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { getClientDb } from '@/lib/firebase/config'
import { CrossProjectBoard } from '@/components/projects/CrossProjectBoard'
import { ProjectListCard } from '@/components/projects/ProjectListCard'
import { ProjectPortfolioReportPanel } from '@/components/projects/ProjectPortfolioReportPanel'
import { EmptyState, PageHeader, PageTabs, Surface } from '@/components/ui/AppFoundation'
import { appendQueryParams, scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { canRolePerformModuleAction, resolveOrganizationModulePolicies } from '@/lib/organizations/module-policies'
import type { BoardTask } from '@/components/projects/CrossProjectBoard'

type ProjectsWorkspaceMode = 'admin' | 'portal'
type ProjectView = 'active' | 'archive'
type WorkspaceSection = 'portfolio' | 'projects'
type ProjectDisplayMode = 'list' | 'board'
type BoardSortMode = 'latest' | 'manual'

interface Project {
  id: string
  orgId?: string
  name: string
  status: string
  description?: string
  createdAt?: unknown
  updatedAt?: unknown
  archived?: boolean
}

interface ProjectsWorkspaceProps {
  mode: ProjectsWorkspaceMode
  orgSlug?: string
  orgScope?: PortalOrgRouteScope
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
const PROJECT_REFRESH_INTERVAL_MS = 60_000

function isHistoricalProject(project: Project): boolean {
  return project.archived === true || project.status?.trim().toLowerCase() === 'completed'
}

function mergeLiveTasks(restTasks: BoardTask[], currentTasks: BoardTask[]) {
  const merged = new Map<string, BoardTask>()
  restTasks.forEach(task => merged.set(task.id, task))
  currentTasks.forEach(task => merged.set(task.id, task))
  return Array.from(merged.values())
}

function receivedProjectsUrl({
  mode,
  orgSlug,
  orgScope,
  projectView,
}: {
  mode: ProjectsWorkspaceMode
  orgSlug?: string
  orgScope: PortalOrgRouteScope
  projectView: ProjectView
}) {
  const archive = projectView === 'archive' ? 'only' : undefined
  if (mode === 'admin') {
    return appendQueryParams('/api/v1/projects', {
      view: 'received',
      orgSlug,
      archive,
    })
  }

  return scopedApiPath(
    appendQueryParams('/api/v1/projects', {
      view: 'received',
      archive,
    }),
    orgScope,
  )
}

function projectReportingUrl({
  mode,
  orgSlug,
  orgScope,
}: {
  mode: ProjectsWorkspaceMode
  orgSlug?: string
  orgScope: PortalOrgRouteScope
}) {
  if (mode === 'admin') {
    return appendQueryParams('/api/v1/projects/reporting', { orgSlug })
  }

  return scopedApiPath('/api/v1/projects/reporting', orgScope)
}

export function ProjectsWorkspace({ mode, orgSlug = '', orgScope = {} }: ProjectsWorkspaceProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('projects')
  const [projectView, setProjectView] = useState<ProjectView>('active')
  const [filter, setFilter] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<ProjectDisplayMode>('list')
  const [boardSortMode, setBoardSortMode] = useState<BoardSortMode>('latest')
  const [boardTasks, setBoardTasks] = useState<BoardTask[]>([])
  const [boardLoading, setBoardLoading] = useState(false)
  const [failedProjectIds, setFailedProjectIds] = useState<string[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formStatus, setFormStatus] = useState('discovery')
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [canRequestProject, setCanRequestProject] = useState(true)
  const liveProjectListenerHealthy = useRef(false)

  const listUrl = useMemo(
    () => receivedProjectsUrl({ mode, orgSlug, orgScope, projectView }),
    [mode, orgScope, orgSlug, projectView],
  )
  const reportUrl = useMemo(
    () => projectReportingUrl({ mode, orgSlug, orgScope }),
    [mode, orgScope, orgSlug],
  )
  const projectHrefBase = mode === 'admin' ? `/admin/org/${orgSlug}/projects` : '/portal/projects'
  const buildProjectHref = useCallback(
    (projectId: string) => (
      mode === 'admin'
        ? `${projectHrefBase}/${encodeURIComponent(projectId)}`
        : scopedPortalPath(`/portal/projects/${encodeURIComponent(projectId)}`, orgScope)
    ),
    [mode, orgScope, projectHrefBase],
  )
  const buildCompanyHref = useCallback(
    (companyId: string) => (
      mode === 'admin'
        ? `/portal/companies/${encodeURIComponent(companyId)}`
        : scopedPortalPath(`/portal/companies/${encodeURIComponent(companyId)}`, orgScope)
    ),
    [mode, orgScope],
  )

  const loadProjects = useCallback(async ({ showSpinner = false }: { showSpinner?: boolean } = {}) => {
    if (showSpinner) setLoading(true)
    try {
      const res = await fetch(listUrl)
      const body = await res.json()
      setProjects(body.data ?? [])
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [listUrl])

  useEffect(() => {
    let cancelled = false
    const refresh = async (options?: { showSpinner?: boolean }) => {
      if (cancelled) return
      if (!options?.showSpinner && document.visibilityState !== 'visible') return
      if (!options?.showSpinner && mode === 'admin' && liveProjectListenerHealthy.current) return
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
  }, [loadProjects, mode])

  const liveOrgId = useMemo(() => projects.find(project => project.orgId)?.orgId, [projects])

  useEffect(() => {
    if (mode !== 'admin' || !liveOrgId) return
    const unsubscribe = onSnapshot(
      query(collection(getClientDb(), 'projects'), where('orgId', '==', liveOrgId)),
      (snap) => {
        liveProjectListenerHealthy.current = true
        snap.docChanges().forEach(change => {
          if (change.type === 'removed') {
            setProjects(prev => prev.filter(project => project.id !== change.doc.id))
            return
          }

          const liveProject = { id: change.doc.id, ...change.doc.data() } as Project
          const visibleInView = projectView === 'archive' ? isHistoricalProject(liveProject) : !isHistoricalProject(liveProject)
          setProjects(prev => {
            if (!visibleInView) return prev.filter(project => project.id !== liveProject.id)
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
      () => {
        liveProjectListenerHealthy.current = false
      },
    )
    return () => {
      liveProjectListenerHealthy.current = false
      unsubscribe()
    }
  }, [liveOrgId, mode, projectView])

  useEffect(() => {
    setFilter('all')
  }, [projectView])

  useEffect(() => {
    if (mode === 'portal' && !canRequestProject) setShowForm(false)
  }, [canRequestProject, mode])

  useEffect(() => {
    if (mode !== 'portal') {
      setCanRequestProject(true)
      return
    }

    let cancelled = false
    fetch(scopedApiPath('/api/v1/portal/org', { orgId: orgScope.orgId, id: orgScope.id }))
      .then((res) => res.ok ? res.json() : null)
      .then((body) => {
        if (cancelled || !body?.org) return
        const policies = resolveOrganizationModulePolicies({ modulePolicies: body.org.modulePolicies })
        const role = body.user?.memberRole ?? body.user?.role
        setCanRequestProject(canRolePerformModuleAction(policies, 'projects', 'create', role))
      })
      .catch(() => {
        if (!cancelled) setCanRequestProject(true)
      })

    return () => {
      cancelled = true
    }
  }, [mode, orgScope.id, orgScope.orgId])

  const filtered = useMemo(
    () => projects.filter((project) => {
      if (filter !== 'all' && project.status !== filter) return false
      const q = searchTerm.trim().toLowerCase()
      if (!q) return true
      return [project.name, project.status, project.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    }),
    [projects, filter, searchTerm],
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
        () => {},
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
        .catch(() => ({ project, tasks: undefined as BoardTask[] | undefined })),
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
    if (mode === 'portal' && !canRequestProject) {
      setFormError('Project requests are disabled for your organisation role.')
      setShowForm(false)
      return
    }

    try {
      setFormError(null)
      setFormLoading(true)

      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          status: formStatus,
          ...(mode === 'admin' ? { orgSlug } : {}),
          ...(mode === 'portal' && orgScope.orgId ? { orgId: orgScope.orgId } : {}),
        }),
      })

      const body = await res.json()

      if (!res.ok) {
        throw new Error(body.error || 'Failed to create project')
      }

      const listRes = await fetch(listUrl)
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
    if (mode !== 'admin') return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/v1/projects?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Failed to archive project')
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

  const isAdmin = mode === 'admin'
  const emptyActiveDescription = isAdmin
    ? 'Try another stage/search filter or create a new client project.'
    : filter === 'all'
      ? 'Projects will appear here once work has been opened for your workspace.'
      : 'Try a different status filter to see more projects.'

  return (
    <div className={isAdmin ? 'space-y-6 max-w-5xl mx-auto' : 'space-y-6'}>
      <PageHeader
        eyebrow={isAdmin ? 'Admin task bus / Projects' : 'Client workspace / Projects'}
        title="Projects"
        description={isAdmin ? 'Kanban-led delivery spaces for client and platform work. Switch between board and list views without leaving the workspace.' : 'Follow active work, timelines, and task progress without exposing internal admin controls.'}
        actions={showForm ? null : (
          <>
            <PageTabs
              ariaLabel="Project workspace sections"
              value={activeSection}
              onValueChange={(value) => setActiveSection(value as WorkspaceSection)}
              tabs={WORKSPACE_TABS}
            />
            {(isAdmin || canRequestProject) ? (
              <button
                onClick={() => setShowForm(true)}
                className="pib-btn-primary text-sm font-label"
              >
                {isAdmin ? 'Create operator project' : 'Request project'}
              </button>
            ) : null}
          </>
        )}
      />

      {showForm && (
        <Surface className={isAdmin ? 'p-4' : undefined}>
          <form onSubmit={handleCreateProject} className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[150px]">
              <input
                type="text"
                placeholder="Project name..."
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
              {STATUS_OPTIONS.map(status => (
                <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <button
              type="submit"
              className="pib-btn-primary text-sm font-label"
              disabled={formLoading || !formName.trim()}
            >
              {formLoading ? 'Creating...' : 'Create'}
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
        <ProjectPortfolioReportPanel
          reportUrl={reportUrl}
          projectHrefBase={projectHrefBase}
          buildProjectHref={buildProjectHref}
          buildCompanyHref={buildCompanyHref}
        />
      ) : null}

      {activeSection === 'projects' ? (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex min-w-0 flex-wrap items-center gap-2 overflow-x-auto">
              <PageTabs
                ariaLabel="Project archive filters"
                value={projectView}
                onValueChange={(value) => setProjectView(value as ProjectView)}
                tabs={PROJECT_VIEW_TABS}
              />
              <PageTabs
                ariaLabel={isAdmin ? 'Project stage filters' : 'Project status filter'}
                value={filter}
                onValueChange={setFilter}
                tabs={PROJECT_STAGE_TABS}
              />
            </div>

            <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:w-auto sm:justify-end">
              <label className="min-w-[220px] flex-1 sm:flex-none">
                <span className="sr-only">Search projects</span>
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search projects..."
                  className="pib-input h-9 text-sm"
                />
              </label>
              <div
                className="flex rounded-[var(--radius-btn)] overflow-hidden border"
                style={{ borderColor: 'var(--color-outline)' }}
              >
                {(['list', 'board'] as const).map(displayMode => (
                  <button
                    key={displayMode}
                    onClick={() => setViewMode(displayMode)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-label capitalize transition-colors"
                    style={
                      viewMode === displayMode
                        ? { background: 'var(--color-accent-v2)', color: '#000' }
                        : { background: 'transparent', color: 'var(--color-on-surface-variant)' }
                    }
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      {displayMode === 'list' ? 'list' : 'view_kanban'}
                    </span>
                    {displayMode}
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
              buildProjectHref={buildProjectHref}
              onTaskUpdate={handleBoardTaskUpdate}
            />
          ) : loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32" />)}
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
                  {filtered.map(project => (
                    <ProjectListCard key={project.id} project={project} href={buildProjectHref(project.id)} />
                  ))}
                </div>
              )}
            </>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={isAdmin ? 'folder_managed' : 'rocket_launch'}
              title="No projects found."
              description={emptyActiveDescription}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map(project => (
                <div key={project.id} className="relative group">
                  <ProjectListCard project={project} href={buildProjectHref(project.id)} />

                  {isAdmin && (confirmId === project.id ? (
                    <div className="absolute top-2 right-2 flex items-center gap-1 bg-[var(--color-surface)] border border-[#ef4444] rounded-md px-2 py-1 shadow-sm z-10">
                      <span className="text-[11px] text-[#ef4444]">Archive?</span>
                      <button
                        onClick={() => handleDelete(project.id)}
                        disabled={deletingId === project.id}
                        className="text-[11px] font-medium text-[#ef4444] hover:underline disabled:opacity-50"
                      >
                        {deletingId === project.id ? '...' : 'Yes'}
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
                      onClick={(e) => {
                        e.preventDefault()
                        setConfirmId(project.id)
                      }}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[#ef444420] text-[#ef4444]"
                      title="Archive project"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
