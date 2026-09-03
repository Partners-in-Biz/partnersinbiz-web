'use client'

import { Icon } from '@/components/studio'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
    let refreshInFlight = false

    const refreshBoard = async ({ showSpinner = false }: { showSpinner?: boolean } = {}) => {
      if (cancelled || refreshInFlight) return
      if (!showSpinner && document.visibilityState !== 'visible') return
      refreshInFlight = true
      if (showSpinner) {
        setBoardLoading(true)
        setFailedProjectIds([])
      }

      try {
        const results = await Promise.all(filtered.map(async (project) => {
          try {
            const response = await fetch(`/api/v1/projects/${project.id}/tasks?view=board`)
            if (!response.ok) throw new Error(`Task refresh failed (${response.status})`)
            const body = await response.json()
            return {
              project,
              tasks: (body.data ?? []).map((task: BoardTask) => ({
                ...task,
                projectId: project.id,
                projectName: project.name,
              })) as BoardTask[],
            }
          } catch {
            return { project, tasks: undefined }
          }
        }))

        if (cancelled) return
        const failed: string[] = []
        const all: BoardTask[] = []
        for (const { project, tasks } of results) {
          if (!tasks) failed.push(project.id)
          else all.push(...tasks)
        }
        setBoardTasks(all)
        setFailedProjectIds(failed)
      } finally {
        refreshInFlight = false
        if (!cancelled) setBoardLoading(false)
      }
    }

    refreshBoard({ showSpinner: true }).catch(() => {
      if (!cancelled) setBoardLoading(false)
    })
    const interval = window.setInterval(() => {
      refreshBoard().catch(() => {})
    }, PROJECT_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
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
    <div className={isAdmin ? 'mx-auto max-w-5xl space-y-4' : 'space-y-4'} data-module-accent="cyan">
      <PageHeader
        accent="cyan"
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
                className="pib-btn-primary btn-pib-sm font-label"
              >
                <Icon name="add" />
                {isAdmin ? 'Create operator project' : 'Request project'}
              </button>
            ) : null}
          </>
        )}
      />

      {showForm && (
        <Surface variant="glass" accentEdge="cyan" className={isAdmin ? '!p-3' : undefined}>
          <form onSubmit={handleCreateProject} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[150px] flex-1">
              <label htmlFor="new-project-name" className="sr-only">Project name</label>
              <input
                id="new-project-name"
                type="text"
                placeholder="Project name..."
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="pib-input h-8 w-full text-sm"
                disabled={formLoading}
                autoFocus
              />
            </div>
            <label htmlFor="new-project-status" className="sr-only">Project status</label>
            <select
              id="new-project-status"
              value={formStatus}
              onChange={(e) => setFormStatus(e.target.value)}
              className="pib-select h-8 text-sm"
              disabled={formLoading}
            >
              {STATUS_OPTIONS.map(status => (
                <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <button
              type="submit"
              className="pib-btn-primary btn-pib-sm font-label"
              disabled={formLoading || !formName.trim()}
            >
              {formLoading ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="pib-btn-secondary btn-pib-sm font-label"
              disabled={formLoading}
            >
              Cancel
            </button>
          </form>
          {formError && (
            <p className="mt-2 text-xs text-[#ef4444]">{formError}</p>
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
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-x-auto">
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

            <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
              <label className="min-w-[200px] flex-1 sm:flex-none">
                <span className="sr-only">Search projects</span>
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search projects..."
                  className="pib-input h-8 text-sm"
                />
              </label>
              <div className="flex overflow-hidden rounded-[var(--radius-btn)] border border-[var(--color-pib-line)]">
                {(['list', 'board'] as const).map(displayMode => (
                  <button
                    key={displayMode}
                    onClick={() => setViewMode(displayMode)}
                    className="flex h-8 items-center gap-1.5 px-2.5 text-xs font-label capitalize transition-colors"
                    style={
                      viewMode === displayMode
                        ? { background: 'var(--color-accent-v2)', color: '#000' }
                        : { background: 'transparent', color: 'var(--color-pib-text-muted)' }
                    }
                  >
                    <Icon name={displayMode === 'list' ? 'list' : 'view_kanban'} />
                    {displayMode}
                  </button>
                ))}
              </div>
              {viewMode === 'board' && !boardLoading && boardTasks.length > 0 && (
                <button
                  type="button"
                  onClick={() => setBoardSortMode(prev => prev === 'latest' ? 'manual' : 'latest')}
                  className="btn-pib-sm inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-btn)] border border-[var(--color-pib-line)] px-2.5 text-xs font-label uppercase tracking-wide text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
                  aria-pressed={boardSortMode === 'manual'}
                >
                  <Icon name="sort" />
                  {boardSortMode === 'latest' ? 'Manual order' : 'Latest first'}
                </button>
              )}
            </div>
          </div>

          {viewMode === 'board' && failedProjectIds.length > 0 && (
            <div
              className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] px-3 py-1.5 text-sm"
              style={{ background: '#ef444420', color: '#f87171', border: '1px solid #ef444430' }}
            >
              <span>Could not load tasks for {failedProjectIds.length} project(s).</span>
              <button
                onClick={() => {
                  setViewMode('list')
                  setTimeout(() => setViewMode('board'), 0)
                }}
                className="shrink-0 text-xs underline"
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28" />)}
            </div>
          ) : projectView === 'archive' ? (
            <>
              <p className="text-sm text-[var(--color-pib-text-muted)]">Completed and archived project history.</p>
              {filtered.length === 0 ? (
                <EmptyState
                  icon="archive"
                  title="No archived projects found."
                  description="Completed and archived projects will appear here after sign-off."
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filtered.map(project => (
                <div key={project.id} className="group relative">
                  <ProjectListCard project={project} href={buildProjectHref(project.id)} />

                  {isAdmin && (confirmId === project.id ? (
                    <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md border border-[#ef4444] bg-[var(--color-surface)] px-2 py-1 shadow-sm">
                      <span className="text-[11px] text-[#ef4444]">Archive?</span>
                      <button
                        onClick={() => handleDelete(project.id)}
                        disabled={deletingId === project.id}
                        className="text-[11px] font-medium text-[#ef4444] hover:underline disabled:opacity-50"
                      >
                        {deletingId === project.id ? '...' : 'Yes'}
                      </button>
                      <span className="text-[11px] text-[var(--color-pib-text-muted)]">/</span>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="text-[11px] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
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
                      className="absolute top-2 right-2 rounded p-1 text-[#ef4444] opacity-0 transition-opacity hover:bg-[#ef444420] group-hover:opacity-100"
                      title="Archive project"
                    >
                      <Icon name="delete" />
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
