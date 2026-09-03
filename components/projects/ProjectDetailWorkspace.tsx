'use client'

import { Icon } from '@/components/studio'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { TaskDetailPanel } from '@/components/kanban/TaskDetailPanel'
import { TaskComposer } from '@/components/kanban/TaskComposer'
import { getTaskStateStyle } from '@/components/kanban/taskStateStyles'
import UnifiedChat from '@/components/chat/UnifiedChat'
import { ProjectBoardSummary } from '@/components/projects/ProjectBoardSummary'
import { ProjectDocsPanel, projectDocContent, type ProjectDoc } from '@/components/projects/ProjectDocsPanel'
import { ProjectPeopleAccessPanel } from '@/components/projects/ProjectPeopleAccessPanel'
import { ProjectSettingsPanel } from '@/components/projects/ProjectSettingsPanel'
import { ProjectSuitePanel } from '@/components/projects/ProjectSuitePanel'
import { PageTabs } from '@/components/ui/AppFoundation'
import { ShareWithPartnerButton } from '@/components/crm/ShareWithPartnerButton'
import type { AgentMember, Column, Task, TeamMember } from '@/components/kanban/types'

interface Project {
  id: string
  orgId?: string
  clientOrgId?: string
  companyId?: string
  contactId?: string
  sourceCompanyId?: string
  sourceContactId?: string
  recipientOrgId?: string
  companyIds?: string[]
  contactIds?: string[]
  sourceCompanyIds?: string[]
  sourceContactIds?: string[]
  recipientOrgIds?: string[]
  name: string
  description?: string
  brief?: string
  status?: string
  columns: Column[]
}
interface CurrentUser { uid: string; displayName: string; role?: string; isSuperAdmin?: boolean }
interface OrganizationOption { id: string; name: string; slug?: string; type?: string; status?: string }
type TaskListSort = 'latest' | 'due'
type ProjectTab = 'kanban' | 'plan' | 'docs' | 'agent' | 'settings'
const PROJECT_TABS: Array<{ id: ProjectTab; label: string; icon: string }> = [
  { id: 'kanban', label: 'Kanban', icon: 'view_kanban' },
  { id: 'plan', label: 'Plan', icon: 'timeline' },
  { id: 'docs', label: 'Docs', icon: 'description' },
  { id: 'agent', label: 'Agent', icon: 'forum' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

function upsertTaskById(existingTasks: Task[], task: Task) {
  const existingIndex = existingTasks.findIndex(existingTask => existingTask.id === task.id)
  const withoutTask = existingTasks.filter(existingTask => existingTask.id !== task.id)
  if (existingIndex < 0) return [...withoutTask, task]
  const insertIndex = Math.min(existingIndex, withoutTask.length)
  return [
    ...withoutTask.slice(0, insertIndex),
    task,
    ...withoutTask.slice(insertIndex),
  ]
}

const DEFAULT_COLUMNS: Column[] = [
  { id: 'backlog',     name: 'Backlog',     color: 'var(--color-outline)',    order: 0 },
  { id: 'todo',        name: 'To Do',       color: '#60a5fa',                 order: 1 },
  { id: 'in_progress', name: 'In Progress', color: 'var(--color-accent-v2)', order: 2 },
  { id: 'blocked',     name: 'Blocked',     color: '#ef4444',                 order: 3 },
  { id: 'review',      name: 'Review',      color: '#c084fc',                 order: 4 },
  { id: 'done',        name: 'Done',        color: '#4ade80',                 order: 5 },
]
const TASK_REFRESH_INTERVAL_MS = 60_000

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

function timestampToMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object') {
    const timestamp = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function formatDate(value: unknown): string {
  const millis = timestampToMillis(value)
  if (!millis) return 'No date'
  return new Date(millis).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatEstimate(minutes?: number | null): string {
  if (!minutes) return 'No estimate'
  if (minutes < 60) return `${minutes}m`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

function memberLabel(member?: TeamMember): string {
  return member?.displayName || member?.email || 'Unassigned'
}

function agentLabel(agent?: AgentMember, agentId?: string | null): string {
  return agent?.name || agentId || ''
}

type ProjectAccessMember = {
  uid?: string
  userId?: string
  role?: string
  displayName?: string
  email?: string
  photoURL?: string
  status?: string
}

function normalizeTeamMemberRole(role?: string): TeamMember['role'] {
  if (role === 'owner') return 'owner'
  if (role === 'admin' || role === 'manager') return 'admin'
  if (role === 'viewer' || role === 'reviewer') return 'viewer'
  return 'member'
}

function mergeProjectAccessMembers(orgMembers: TeamMember[], accessMembers: ProjectAccessMember[]): TeamMember[] {
  const merged = new Map<string, TeamMember>()
  orgMembers.forEach(member => merged.set(member.userId, member))
  accessMembers.forEach(member => {
    const userId = member.userId || member.uid
    if (!userId || member.status === 'revoked') return
    const existing = merged.get(userId)
    merged.set(userId, {
      userId,
      role: existing?.role ?? normalizeTeamMemberRole(member.role),
      displayName: existing?.displayName ?? member.displayName,
      email: existing?.email ?? member.email,
      photoURL: existing?.photoURL ?? member.photoURL,
    })
  })
  return Array.from(merged.values())
}

function normalizeRelationshipIds(values?: string[], excludedIds: string[] = []): string[] {
  if (!Array.isArray(values)) return []
  const excluded = new Set(excludedIds.map(value => value.trim()).filter(Boolean))
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean))).filter(value => !excluded.has(value))
}

export type ProjectDetailWorkspaceMode = 'admin' | 'portal'

interface ProjectDetailWorkspaceProps {
  mode: ProjectDetailWorkspaceMode
  projectId: string
  orgSlug?: string
  orgScope?: PortalOrgRouteScope
  deepLinkedTaskId?: string | null
  onAdminProjectMoved?: (nextOrgSlug: string) => void
}

export function ProjectDetailWorkspace({
  mode,
  projectId,
  orgSlug = '',
  orgScope = {},
  deepLinkedTaskId = null,
  onAdminProjectMoved,
}: ProjectDetailWorkspaceProps) {
  const isAdmin = mode === 'admin'

  const [project, setProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [docs, setDocs] = useState<ProjectDoc[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [agents, setAgents] = useState<AgentMember[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showNewTask, setShowNewTask] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ProjectTab>('kanban')
  const [viewMode, setViewMode] = useState<'board' | 'list'>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'board'
    return window.matchMedia('(max-width: 767px)').matches ? 'list' : 'board'
  })
  const [boardSortMode, setBoardSortMode] = useState<'latest' | 'manual'>('latest')
  const [taskListSort, setTaskListSort] = useState<TaskListSort>('latest')
  const [editingBrief, setEditingBrief] = useState(false)
  const [briefValue, setBriefValue] = useState('')
  const [editingDoc, setEditingDoc] = useState<ProjectDoc | null>(null)
  const [selectedDoc, setSelectedDoc] = useState<ProjectDoc | null>(null)
  const [savingBrief, setSavingBrief] = useState(false)
  const [settingsName, setSettingsName] = useState('')
  const [settingsStatus, setSettingsStatus] = useState('discovery')
  const [settingsSurfaceMode, setSettingsSurfaceMode] = useState('')
  const [settingsDescription, setSettingsDescription] = useState('')
  const [settingsSourceCompanyId, setSettingsSourceCompanyId] = useState('')
  const [settingsAdditionalCompanyIds, setSettingsAdditionalCompanyIds] = useState<string[]>([])
  const [settingsSourceContactId, setSettingsSourceContactId] = useState('')
  const [settingsAdditionalContactIds, setSettingsAdditionalContactIds] = useState<string[]>([])
  const [orgOptions, setOrgOptions] = useState<OrganizationOption[]>([])
  const [targetOrgId, setTargetOrgId] = useState('')
  const [movingProject, setMovingProject] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [userLoadError, setUserLoadError] = useState<string | null>(null)
  const taskMutationVersionRef = useRef(0)

  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/v1/organizations')
      .then(r => r.json())
      .then(body => setOrgOptions((body.data ?? []).filter((org: OrganizationOption) => org.type !== 'platform')))
      .catch(() => setOrgOptions([]))
  }, [isAdmin])

  useEffect(() => {
    if (!project) return
    setTargetOrgId(project.clientOrgId ?? project.orgId ?? '')
  }, [project])

  const refreshTasks = useCallback(async () => {
    const mutationVersionAtRequest = taskMutationVersionRef.current
    const res = await fetch(`/api/v1/projects/${projectId}/tasks?view=board`)
    if (!res.ok) throw new Error(`Task refresh failed (${res.status})`)
    const body = await res.json()
    const nextTasks = (body.data ?? []) as Task[]
    // Do not let a response started before a local create/update/delete erase
    // the mutation. The next 15-second refresh reconciles the server result.
    if (taskMutationVersionRef.current !== mutationVersionAtRequest) return
    setTasks(nextTasks)
    setSelectedTask(prev => {
      if (!prev) return prev
      const freshTask = nextTasks.find(task => task.id === prev.id)
      return freshTask ?? prev
    })
  }, [projectId])

  const openTask = useCallback((task: Task) => {
    setSelectedTask(task)
    void fetch(`/api/v1/projects/${projectId}/tasks/${task.id}`)
      .then(async (res) => res.ok ? res.json() : null)
      .then((body) => {
        const fullTask = body?.data as Task | undefined
        if (!fullTask?.id) return
        setTasks(prev => prev.map((item) => item.id === fullTask.id ? { ...item, ...fullTask } : item))
        setSelectedTask(prev => prev?.id === fullTask.id ? { ...prev, ...fullTask } : prev)
      })
      .catch(() => {})
  }, [projectId])

  useEffect(() => {
    // Project + docs: one-shot fetch
    Promise.all([
      fetch(`/api/v1/projects/${projectId}`).then(r => r.json()),
      fetch(`/api/v1/projects/${projectId}/docs`).then(r => r.json()),
    ]).then(([pBody, dBody]) => {
      setProject(pBody.data)
      setDocs(dBody.data ?? [])
      setBriefValue(pBody.data?.brief ?? '')
      setSettingsName(pBody.data?.name ?? '')
      setSettingsStatus(pBody.data?.status ?? 'discovery')
      setSettingsSurfaceMode(pBody.data?.surfaceMode ?? '')
      setSettingsDescription(pBody.data?.description ?? '')
      const primaryCompanyId = pBody.data?.sourceCompanyId ?? pBody.data?.companyId ?? ''
      const primaryContactId = pBody.data?.sourceContactId ?? pBody.data?.contactId ?? ''
      setSettingsSourceCompanyId(primaryCompanyId)
      setSettingsAdditionalCompanyIds(normalizeRelationshipIds(pBody.data?.companyIds, [primaryCompanyId]))
      setSettingsSourceContactId(primaryContactId)
      setSettingsAdditionalContactIds(normalizeRelationshipIds(pBody.data?.contactIds, [primaryContactId]))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    let refreshInFlight = false

    const refresh = async ({ force = false }: { force?: boolean } = {}) => {
      if (cancelled || refreshInFlight) return
      if (!force && document.visibilityState !== 'visible') return
      refreshInFlight = true
      try {
        await refreshTasks()
      } catch {
        // Keep the last known board state if an API refresh misses a tick.
      } finally {
        refreshInFlight = false
      }
    }

    refresh({ force: true })

    const refreshInterval = window.setInterval(() => {
      refresh()
    }, TASK_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(refreshInterval)
    }
  }, [projectId, refreshTasks])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/verify')
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error ?? `User load failed (${res.status})`)
        const uid = typeof body?.uid === 'string' ? body.uid : ''
        if (!uid) throw new Error('User load failed')
        const displayName =
          (typeof body?.name === 'string' && body.name.trim()) ||
          (typeof body?.email === 'string' && body.email.trim()) ||
          uid
        if (!cancelled) {
          setCurrentUser({
            uid,
            displayName,
            role: typeof body?.role === 'string' ? body.role : undefined,
            isSuperAdmin: body?.isSuperAdmin === true,
          })
          setUserLoadError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setUserLoadError(err instanceof Error ? err.message : 'User load failed')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!deepLinkedTaskId) return
    const task = tasks.find(t => t.id === deepLinkedTaskId)
    if (!task) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setActiveTab('kanban')
      openTask(task)
    })
    return () => { cancelled = true }
  }, [deepLinkedTaskId, tasks])

  useEffect(() => {
    if (!project?.orgId) return
    Promise.all([
      fetch(`/api/v1/organizations/${project.orgId}/members`).then(r => r.json()),
      fetch(`/api/v1/projects/${projectId}/access`).then(r => r.json()).catch(() => ({ data: { members: [] } })),
    ])
      .then(([orgBody, accessBody]) => {
        setMembers(mergeProjectAccessMembers(orgBody.data ?? [], accessBody.data?.members ?? []))
      })
      .catch(() => setMembers([]))
    fetch(`/api/v1/orgs/${project.orgId}/visible-agents`)
      .then(r => r.json())
      .then(body => setAgents(body.data ?? []))
      .catch(() => setAgents([]))
  }, [project?.orgId, projectId])

  const handleTaskMove = useCallback(async (taskId: string, newColumnId: string, newOrder: number) => {
    const res = await fetch(`/api/v1/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId: newColumnId, order: newOrder }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok || body?.success === false) {
      throw new Error(typeof body?.error === 'string' ? body.error : `Task move failed (${res.status})`)
    }
    taskMutationVersionRef.current += 1
    // Mirror applyAgentColumnMoveState so Done/Review cards do not keep a stale Review tone
    // while the next 15s refresh catches up.
    setTasks(prev => prev.map((task) => {
      if (task.id !== taskId) return task
      const next: Task = { ...task, columnId: newColumnId, order: newOrder }
      const hasReviewer = Boolean(task.reviewerAgentId || (task.reviewerIds && task.reviewerIds.length > 0))
      if (newColumnId === 'done') {
        if (task.assigneeAgentId) next.agentStatus = 'done'
        // Mirror applyAgentColumnMoveState: done never auto-approves when a reviewer
        // is assigned - the card lands back in Review (awaiting-review) so only an
        // explicit reviewer action can approve it.
        next.reviewStatus = hasReviewer ? 'pending' : 'approved'
        if (hasReviewer) next.columnId = 'review'
      } else if (newColumnId === 'review') {
        if (task.assigneeAgentId) next.agentStatus = 'done'
        next.reviewStatus = 'pending'
      } else if (newColumnId === 'in_progress' && task.assigneeAgentId) {
        next.agentStatus = 'in-progress'
        next.reviewStatus = null
      } else if (newColumnId === 'todo' && task.assigneeAgentId && (task.agentStatus === 'done' || task.agentStatus === 'blocked' || task.agentStatus === 'awaiting-input')) {
        next.agentStatus = 'pending'
        next.reviewStatus = 'changes-requested'
      }
      return next
    }))
    setSelectedTask(prev => {
      if (!prev || prev.id !== taskId) return prev
      const next: Task = { ...prev, columnId: newColumnId, order: newOrder }
      const hasReviewer = Boolean(prev.reviewerAgentId || (prev.reviewerIds && prev.reviewerIds.length > 0))
      if (newColumnId === 'done') {
        if (prev.assigneeAgentId) next.agentStatus = 'done'
        next.reviewStatus = hasReviewer ? 'pending' : 'approved'
        if (hasReviewer) next.columnId = 'review'
      }
      return next
    })
  }, [projectId])

  const handleTaskUpdate = useCallback(async (taskId: string, updates: Partial<Task>) => {
    const res = await fetch(`/api/v1/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok || body?.success === false) {
      throw new Error(typeof body?.error === 'string' ? body.error : `Task update failed (${res.status})`)
    }
    taskMutationVersionRef.current += 1
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))
    setSelectedTask(prev => prev?.id === taskId ? { ...prev, ...updates } as Task : prev)
  }, [projectId])

  const handleTaskDelete = useCallback(async (taskId: string) => {
    taskMutationVersionRef.current += 1
    setTasks(prev => prev.filter(t => t.id !== taskId))
    await fetch(`/api/v1/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' })
  }, [projectId])

  const handleSaveSettings = async () => {
    if (!settingsName.trim()) return
    const cleanSourceCompanyId = settingsSourceCompanyId.trim()
    const cleanSourceContactId = settingsSourceContactId.trim()
    const cleanAdditionalCompanyIds = normalizeRelationshipIds(settingsAdditionalCompanyIds, [cleanSourceCompanyId])
    const cleanAdditionalContactIds = normalizeRelationshipIds(settingsAdditionalContactIds, [cleanSourceContactId])
    const cleanCompanyIds = [cleanSourceCompanyId, ...cleanAdditionalCompanyIds].filter(Boolean)
    const cleanContactIds = [cleanSourceContactId, ...cleanAdditionalContactIds].filter(Boolean)
    setSavingSettings(true)
    setSettingsSaved(false)
    await fetch(`/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: settingsName.trim(),
        status: settingsStatus,
        surfaceMode: settingsSurfaceMode || null,
        description: settingsDescription,
        companyId: cleanSourceCompanyId || undefined,
        sourceCompanyId: cleanSourceCompanyId || undefined,
        companyIds: cleanCompanyIds,
        contactId: cleanSourceContactId || undefined,
        sourceContactId: cleanSourceContactId || undefined,
        contactIds: cleanContactIds,
      }),
    })
    setProject(prev => prev ? {
      ...prev,
      name: settingsName.trim(),
      status: settingsStatus,
      surfaceMode: settingsSurfaceMode || null,
      description: settingsDescription,
      companyId: cleanSourceCompanyId || undefined,
      sourceCompanyId: cleanSourceCompanyId || undefined,
      companyIds: cleanCompanyIds,
      contactId: cleanSourceContactId || undefined,
      sourceContactId: cleanSourceContactId || undefined,
      contactIds: cleanContactIds,
    } : null)
    setSettingsAdditionalCompanyIds(cleanAdditionalCompanyIds)
    setSettingsAdditionalContactIds(cleanAdditionalContactIds)
    setSavingSettings(false)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2500)
  }

  const handleMoveProject = async () => {
    if (!isAdmin || !project || !targetOrgId || targetOrgId === (project.clientOrgId ?? project.orgId)) return
    const selectedOrg = orgOptions.find(org => org.id === targetOrgId)
    const targetLabel = selectedOrg?.name ?? targetOrgId
    const confirmed = window.confirm(`Move "${project.name}" to ${targetLabel}? This updates the project board, project tasks, standalone project tasks, unbilled time/expenses, and project calendar events. Billed financial records stay with the original client for audit history.`)
    if (!confirmed) return

    setMovingProject(true)
    setMoveError(null)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetOrgId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? `Move failed (${res.status})`)
      const result = body.data ?? {}
      const nextSlug = result.targetOrgSlug || selectedOrg?.slug
      if (nextSlug) {
        onAdminProjectMoved?.(nextSlug)
        return
      }
      setProject(prev => prev ? { ...prev, orgId: targetOrgId, clientOrgId: targetOrgId } : null)
      setMoveError(null)
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : 'Failed to move project')
    } finally {
      setMovingProject(false)
    }
  }

  const handleSaveBrief = async () => {
    setSavingBrief(true)
    await fetch(`/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: briefValue }),
    })
    setProject(prev => prev ? { ...prev, brief: briefValue } : null)
    setEditingBrief(false)
    setSavingBrief(false)
  }

  const handleDeleteDoc = async (docId: string) => {
    if (isAdmin && !window.confirm('Are you sure?')) return
    await fetch(`/api/v1/projects/${projectId}/docs/${docId}`, { method: 'DELETE' })
    setDocs(prev => prev.filter(d => d.id !== docId))
    setSelectedDoc(prev => prev?.id === docId ? null : prev)
  }

  const handleSaveDoc = async () => {
    if (!editingDoc?.title.trim() || !projectDocContent(editingDoc.content).trim()) return

    if (editingDoc.id) {
      await fetch(`/api/v1/projects/${projectId}/docs/${editingDoc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editingDoc.title, content: projectDocContent(editingDoc.content), type: editingDoc.type }),
      })
      setDocs(prev => prev.map(d => d.id === editingDoc.id ? editingDoc : d))
      setSelectedDoc(prev => prev?.id === editingDoc.id ? editingDoc : prev)
    } else {
      const res = await fetch(`/api/v1/projects/${projectId}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editingDoc.title, content: projectDocContent(editingDoc.content), type: editingDoc.type }),
      })
      const body = await res.json()
      if (body.data?.id) {
        const createdDoc = { ...editingDoc, id: body.data.id } as ProjectDoc
        setDocs(prev => [createdDoc, ...prev])
        setSelectedDoc(createdDoc)
      }
    }
    setEditingDoc(null)
  }

  function handleTaskCreated(task: Task) {
    taskMutationVersionRef.current += 1
    setTasks(prev => upsertTaskById(prev, task))
  }

  const columns = project?.columns?.length ? project.columns : DEFAULT_COLUMNS
  const backHref = isAdmin ? `/admin/org/${orgSlug}/projects` : scopedPortalPath('/portal/projects', orgScope)
  const visibleTabs = isAdmin ? PROJECT_TABS : PROJECT_TABS.filter(tab => tab.id !== 'agent')
  const selectedColumn = columns.find(c => c.id === selectedTask?.columnId)
  const composerColumn = columns.find(c => c.id === showNewTask) ?? null
  const canUseAgentAssignments = isAdmin || currentUser?.isSuperAdmin === true || currentUser?.role === 'admin' || currentUser?.role === 'ai'
  const hideAgentAssignmentControls = !canUseAgentAssignments
  const sortedListTasks = [...tasks].sort((a, b) => {
    if (taskListSort === 'latest') {
      const latestA = timestampToMillis(a.createdAt) || timestampToMillis(a.updatedAt) || a.order || 0
      const latestB = timestampToMillis(b.createdAt) || timestampToMillis(b.updatedAt) || b.order || 0
      return latestB - latestA || a.order - b.order
    }
    const dueA = timestampToMillis(a.dueDate) || Number.MAX_SAFE_INTEGER
    const dueB = timestampToMillis(b.dueDate) || Number.MAX_SAFE_INTEGER
    return dueA - dueB || a.order - b.order
  })

  return (
    <div className="flex h-full min-w-0 flex-col" data-module-accent="cyan">
      {/* Header */}
      <div className="mb-2.5 flex shrink-0 items-start justify-between gap-3 md:mb-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 shrink-0" aria-hidden="true">
            <Icon name="folder_managed" />
          </span>
          <div className="min-w-0">
            <div className="mb-0.5 flex min-w-0 items-center gap-2 overflow-hidden text-[11px] text-[var(--color-pib-text-muted)]">
              <Link href={backHref} className="transition-colors hover:text-[var(--color-pib-text)]">Projects</Link>
              <span>/</span>
              <span className="truncate text-[var(--color-pib-text)]">{project?.name ?? '...'}</span>
            </div>
            <h1 className="truncate text-lg font-headline font-medium text-[var(--color-pib-text)] md:text-xl">
              {loading ? '...' : project?.name}
            </h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mode === 'portal' && projectId ? (
            <ShareWithPartnerButton
              resourceType="project"
              resourceId={projectId}
              label="Share"
              orgScope={orgScope}
              className="btn-pib-secondary btn-pib-sm inline-flex items-center gap-1.5 font-label"
            />
          ) : null}
          {activeTab === 'kanban' && (
            <button
              onClick={() => setShowNewTask('todo')}
              className="pib-btn-primary btn-pib-sm shrink-0 font-label"
            >
              <Icon name="add_task" />
              <span className="hidden sm:inline">New Task</span>
              <span className="sm:hidden">New</span>
            </button>
          )}
        </div>
      </div>

      <PageTabs
        className="mb-2.5 shrink-0 md:mb-3"
        ariaLabel="Project detail tabs"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ProjectTab)}
        tabs={visibleTabs.map((tab) => ({ label: tab.label, value: tab.id, icon: tab.icon }))}
      />

      {/* Tab Content */}
      {activeTab === 'kanban' && (
        <>
          <ProjectBoardSummary tasks={tasks} columns={columns} />

          <div className="mb-2.5 flex min-w-0 max-w-full shrink-0 items-center justify-between gap-2 overflow-x-auto md:mb-3">
            <div className="inline-flex h-8 shrink-0 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] p-0.5">
              {(['board', 'list'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`inline-flex h-7 items-center gap-1 rounded px-2.5 text-xs font-label capitalize ${
                    viewMode === mode
                      ? 'bg-[var(--color-accent-v2)] text-black'
                      : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
                  }`}
                >
                  <Icon name={mode === 'board' ? 'view_kanban' : 'view_list'} />
                  {mode}
                </button>
              ))}
            </div>
            {viewMode === 'board' ? (
              <button
                type="button"
                onClick={() => setBoardSortMode(prev => prev === 'latest' ? 'manual' : 'latest')}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-pib-line)] px-2.5 text-xs font-label uppercase tracking-wide text-[var(--color-pib-text-muted)] transition-colors hover:text-[var(--color-pib-text)]"
                aria-pressed={boardSortMode === 'manual'}
              >
                <Icon name="sort" />
                {boardSortMode === 'latest' ? 'Manual order' : 'Latest first'}
              </button>
            ) : (
              <div className="inline-flex h-8 shrink-0 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] p-0.5">
                {([
                  { key: 'latest', label: 'Latest first', icon: 'new_releases' },
                  { key: 'due', label: 'Due date', icon: 'event' },
                ] as const).map(option => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setTaskListSort(option.key)}
                    className={`inline-flex h-7 items-center gap-1 rounded px-2.5 text-xs font-label ${
                      taskListSort === option.key
                        ? 'bg-[var(--color-accent-v2)] text-black'
                        : 'text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
                    }`}
                    aria-pressed={taskListSort === option.key}
                  >
                    <Icon name={option.icon} />
                    <span className="hidden sm:inline">{option.label}</span>
                    <span className="sm:hidden">{option.key === 'latest' ? 'Latest' : 'Due'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Board */}
          {loading ? (
            <div className="min-w-0 max-w-full overflow-x-auto">
              <div className="flex gap-4">
                {DEFAULT_COLUMNS.map(c => (
                  <div key={c.id} className="w-72 shrink-0 space-y-2">
                    <Skeleton className="h-6 w-24" />
                    {[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}
                  </div>
                ))}
              </div>
            </div>
          ) : viewMode === 'list' ? (
            <div className="flex-1 overflow-auto rounded-[var(--radius-btn)] border border-[var(--color-pib-line)]">
              <div className="space-y-2 p-2 md:hidden" data-testid={mode === 'portal' ? 'portal-mobile-task-list' : 'admin-mobile-task-list'}>
                {sortedListTasks.map(task => {
                  const stateStyle = getTaskStateStyle(task)
                  const stageLabel = columns.find(c => c.id === task.columnId)?.name ?? task.columnId
                  const assigneeIds = task.assigneeIds?.length ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : []
                  const people = [
                    ...assigneeIds.map(id => memberLabel(members.find(member => member.userId === id))),
                    task.assigneeAgentId ? agentLabel(agents.find(agent => agent.agentId === task.assigneeAgentId), task.assigneeAgentId) : '',
                  ].filter(Boolean).join(', ') || 'Unassigned'
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => openTask(task)}
                      data-state-tone={stateStyle.tone}
                      className="w-full rounded-[var(--radius-card)] border border-[var(--color-pib-line)] p-3 text-left shadow-sm transition-colors hover:border-[var(--color-accent-v2)]"
                      style={{ background: stateStyle.tint, borderLeft: `4px solid ${stateStyle.railColor}` }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{task.title}</p>
                          <p className="mt-1 truncate text-[11px] text-[var(--color-pib-text-muted)]">{people}</p>
                        </div>
                        <span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-label uppercase tracking-wide ${stateStyle.pillClassName}`}>
                          {stageLabel}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--color-pib-text-muted)]">
                        <span className="inline-flex items-center gap-1"><Icon name="event" />{formatDate(task.dueDate)}</span>
                        <span className="inline-flex items-center gap-1"><Icon name="schedule" />{formatEstimate(task.estimateMinutes)}</span>
                        {(task.attachments?.length ?? 0) > 0 && <span className="ml-auto inline-flex items-center gap-1"><Icon name="attach_file" />{task.attachments?.length ?? 0}</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
              <table className="hidden w-full min-w-[760px] text-left text-sm md:table">
                <thead className="sticky top-0 bg-[var(--color-sidebar)] text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                  <tr className="border-b border-[var(--color-pib-line)]">
                    <th className="px-4 py-3">Task</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3">People</th>
                    <th className="px-4 py-3">Due</th>
                    <th className="px-4 py-3">Estimate</th>
                    <th className="px-4 py-3">Files</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedListTasks.map(task => {
                    const stateStyle = getTaskStateStyle(task)
                    const stageLabel = columns.find(c => c.id === task.columnId)?.name ?? task.columnId
                    const assigneeIds = task.assigneeIds?.length ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : []
                    return (
                      <tr
                        key={task.id}
                        onClick={() => openTask(task)}
                        data-state-tone={stateStyle.tone}
                        className="cursor-pointer border-b border-[var(--color-pib-line)] hover:bg-[var(--color-row-hover)]"
                        style={{ background: stateStyle.tint, boxShadow: `inset 4px 0 0 ${stateStyle.railColor}` }}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-[var(--color-pib-text)]">{task.title}</p>
                          {task.labels?.length ? <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{task.labels.join(', ')}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-[var(--color-pib-text-muted)]">
                          <span className={`inline-flex rounded-md border px-2 py-1 text-[10px] font-label uppercase tracking-wide ${stateStyle.pillClassName}`}>
                            {stageLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[var(--color-pib-text-muted)]">
                          {[
                            ...assigneeIds.map(id => memberLabel(members.find(member => member.userId === id))),
                            task.assigneeAgentId ? agentLabel(agents.find(agent => agent.agentId === task.assigneeAgentId), task.assigneeAgentId) : '',
                          ].filter(Boolean).join(', ') || 'Unassigned'}
                        </td>
                        <td className="px-4 py-3 text-[var(--color-pib-text-muted)]">{formatDate(task.dueDate)}</td>
                        <td className="px-4 py-3 text-[var(--color-pib-text-muted)]">{formatEstimate(task.estimateMinutes)}</td>
                        <td className="px-4 py-3 text-[var(--color-pib-text-muted)]">{task.attachments?.length ?? 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="min-w-0 flex-1 overflow-hidden">
              <KanbanBoard
                columns={columns}
                tasks={tasks}
                members={members}
                agents={agents}
                sortMode={boardSortMode}
                onSortModeChange={setBoardSortMode}
                showSortToggle={false}
                onTaskMove={handleTaskMove}
                onTaskClick={openTask}
                onAddTask={(columnId) => setShowNewTask(columnId)}
              />
            </div>
          )}
        </>
      )}

      {activeTab === 'docs' && (
        <ProjectDocsPanel
          briefValue={briefValue}
          docs={docs}
          editingBrief={editingBrief}
          editingDoc={editingDoc}
          selectedDoc={selectedDoc}
          savingBrief={savingBrief}
          onBriefChange={setBriefValue}
          onEditBrief={() => setEditingBrief(true)}
          onCancelBrief={() => { setEditingBrief(false); setBriefValue(project?.brief ?? '') }}
          onSaveBrief={handleSaveBrief}
          onEditDoc={setEditingDoc}
          onEditingDocChange={setEditingDoc}
          onSelectDoc={setSelectedDoc}
          onSaveDoc={handleSaveDoc}
          onDeleteDoc={handleDeleteDoc}
        />
      )}

      {activeTab === 'plan' && (
        <ProjectSuitePanel projectId={projectId} orgId={project?.orgId} />
      )}

      {activeTab === 'agent' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden -mx-4 -my-8 md:mx-0 md:my-0 h-[calc(100dvh-56px)] lg:h-[calc(100dvh-120px)]">
          <div className="pib-card mb-4 hidden shrink-0 rounded-[var(--radius-card)] p-5 lg:block">
            <p className="pib-label mb-1">
              {isAdmin ? 'Operator task-bus chat' : 'Project / Agent chat'}
            </p>
            <h2 className="text-2xl font-headline font-medium text-[var(--color-pib-text)]">Project chat</h2>
            <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">
              Same chat engine as the sidebar, scoped to this project with streaming, approvals, voice, and file uploads.
            </p>
          </div>
          {!project?.orgId || !currentUser ? (
            <div className="pib-card flex flex-1 items-center justify-center p-6 text-center text-sm text-[var(--color-pib-text-muted)]">
              {userLoadError ? `Project chat unavailable: ${userLoadError}` : 'Loading project chat…'}
            </div>
          ) : (
            <UnifiedChat
              orgId={project.orgId}
              currentUserUid={currentUser.uid}
              currentUserDisplayName={currentUser.displayName}
              userRole={isAdmin ? 'admin' : 'client'}
              orgName={project.name}
              projectId={projectId}
              scope="project"
              scopeRefId={projectId}
              includeAllScopes
              initialAgentId="pip"
              autoCreateScopedConversation
              autoCreateTitle={`Project: ${project.name}`}
              allowDeleteConversations
            />
          )}
        </div>
      )}

      {activeTab === 'settings' && (
        <ProjectSettingsPanel
          name={settingsName}
          status={settingsStatus}
          surfaceMode={settingsSurfaceMode}
          description={settingsDescription}
          saving={savingSettings}
          saved={settingsSaved}
          onNameChange={setSettingsName}
          onStatusChange={setSettingsStatus}
          onSurfaceModeChange={setSettingsSurfaceMode}
          onDescriptionChange={setSettingsDescription}
          sourceCompanyId={settingsSourceCompanyId}
          additionalCompanyIds={settingsAdditionalCompanyIds}
          sourceContactId={settingsSourceContactId}
          additionalContactIds={settingsAdditionalContactIds}
          onSourceCompanyIdChange={setSettingsSourceCompanyId}
          onAdditionalCompanyIdsChange={setSettingsAdditionalCompanyIds}
          onSourceContactIdChange={setSettingsSourceContactId}
          onAdditionalContactIdsChange={setSettingsAdditionalContactIds}
          onSave={handleSaveSettings}
          peopleAccessSlot={<ProjectPeopleAccessPanel projectId={projectId} />}
          adminTransferSlot={isAdmin ? (
            <div className="rounded-[var(--radius-card)] border border-amber-500/30 bg-[var(--st-warning)]/5 p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <Icon name="move_up" className="mt-0.5 text-[var(--st-warning)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-label uppercase tracking-widest text-[var(--st-warning)]/80">Admin transfer</p>
                  <h3 className="mt-1 text-lg font-headline font-medium text-[var(--color-pib-text)]">Move project to another client</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                    Use this when a project was created under the wrong client. The move updates project visibility, project Kanban tasks, standalone tasks linked by projectId, unbilled time/expenses, and related calendar events. Billed financial records are left on the original client for audit safety.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div>
                  <label htmlFor="project-transfer-client" className="pib-label">Target client</label>
                  <select
                    id="project-transfer-client"
                    value={targetOrgId}
                    onChange={e => setTargetOrgId(e.target.value)}
                    className="pib-select w-full"
                  >
                    <option value="">Choose a client…</option>
                    {orgOptions.map(org => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleMoveProject}
                  disabled={movingProject || !targetOrgId || targetOrgId === (project?.clientOrgId ?? project?.orgId)}
                  className="rounded-[var(--radius-card)] border border-amber-400/50 px-4 py-3 text-sm font-label text-[var(--st-warning)] transition-colors hover:bg-[var(--st-warning)]/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {movingProject ? 'Moving…' : 'Move Project'}
                </button>
              </div>
              {moveError && (
                <p className="mt-3 rounded-[var(--radius-card)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">{moveError}</p>
              )}
            </div>

          ) : undefined}
        />
      )}

      {/* Task detail panel */}
      {selectedTask && activeTab === 'kanban' && (
        <TaskDetailPanel
          task={selectedTask}
          columnName={selectedColumn?.name ?? ''}
          projectId={projectId}
          orgId={project?.orgId}
          members={members}
          agents={agents}
          hideAgentSection={hideAgentAssignmentControls}
          surface={isAdmin ? 'admin' : 'portal'}
          canManageApprovalGates={isAdmin || currentUser?.isSuperAdmin === true || currentUser?.role === 'admin'}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleTaskUpdate}
          onDelete={handleTaskDelete}
        />
      )}
      <TaskComposer
        open={!!showNewTask}
        column={composerColumn}
        projectId={projectId}
        orgId={project?.orgId}
        members={members}
        agents={agents}
        existingTasks={tasks}
        hideAgentSection={hideAgentAssignmentControls}
        surface={isAdmin ? 'admin' : 'portal'}
        onClose={() => setShowNewTask(null)}
        onCreated={handleTaskCreated}
      />
    </div>
  )
}
