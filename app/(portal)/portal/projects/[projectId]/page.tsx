'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { collection, onSnapshot } from 'firebase/firestore'
import { getClientDb } from '@/lib/firebase/config'
import Link from 'next/link'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { TaskDetailPanel } from '@/components/kanban/TaskDetailPanel'
import { TaskComposer } from '@/components/kanban/TaskComposer'
import { ProjectBoardSummary } from '@/components/projects/ProjectBoardSummary'
import { ProjectDocsPanel, projectDocContent, type ProjectDoc } from '@/components/projects/ProjectDocsPanel'
import { ProjectPeopleAccessPanel } from '@/components/projects/ProjectPeopleAccessPanel'
import { ProjectSettingsPanel } from '@/components/projects/ProjectSettingsPanel'
import { ProjectSuitePanel } from '@/components/projects/ProjectSuitePanel'
import { PageTabs } from '@/components/ui/AppFoundation'
import type { AgentMember, Column, Task, TeamMember } from '@/components/kanban/types'

interface Project { id: string; orgId?: string; name: string; description?: string; brief?: string; status?: string; columns: Column[] }
type TaskListSort = 'latest' | 'due'
type ProjectTab = 'kanban' | 'plan' | 'docs' | 'settings'
const PROJECT_TABS: Array<{ id: ProjectTab; label: string; icon: string }> = [
  { id: 'kanban', label: 'Kanban', icon: 'view_kanban' },
  { id: 'plan', label: 'Plan', icon: 'timeline' },
  { id: 'docs', label: 'Docs', icon: 'description' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

function mergeLiveTasks(restTasks: Task[], currentTasks: Task[]) {
  const merged = new Map<string, Task>()
  restTasks.forEach(task => merged.set(task.id, task))
  currentTasks.forEach(task => merged.set(task.id, task))
  return Array.from(merged.values())
}

const DEFAULT_COLUMNS: Column[] = [
  { id: 'backlog',     name: 'Backlog',     color: 'var(--color-outline)',    order: 0 },
  { id: 'todo',        name: 'To Do',       color: '#60a5fa',                 order: 1 },
  { id: 'in_progress', name: 'In Progress', color: 'var(--color-accent-v2)', order: 2 },
  { id: 'blocked',     name: 'Blocked',     color: '#ef4444',                 order: 3 },
  { id: 'review',      name: 'Review',      color: '#c084fc',                 order: 4 },
  { id: 'done',        name: 'Done',        color: '#4ade80',                 order: 5 },
]

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

export default function ProjectDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const projectId = params.projectId as string
  const deepLinkedTaskId = searchParams.get('taskId') ?? searchParams.get('task')

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
  const [settingsDescription, setSettingsDescription] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/v1/projects/${projectId}`).then(r => r.json()),
      fetch(`/api/v1/projects/${projectId}/docs`).then(r => r.json()),
    ]).then(([pBody, dBody]) => {
      setProject(pBody.data)
      setDocs(dBody.data ?? [])
      setBriefValue(pBody.data?.brief ?? '')
      setSettingsName(pBody.data?.name ?? '')
      setSettingsStatus(pBody.data?.status ?? 'discovery')
      setSettingsDescription(pBody.data?.description ?? '')
      setLoading(false)
    }).catch(() => setLoading(false))

    fetch(`/api/v1/projects/${projectId}/tasks`).then(r => r.json())
      .then(body => setTasks(prev => mergeLiveTasks(body.data ?? [], prev)))
      .catch(() => {})

    const unsubscribe = onSnapshot(
      collection(getClientDb(), 'projects', projectId, 'tasks'),
      (snap) => {
        snap.docChanges().forEach(change => {
          const taskData = { id: change.doc.id, ...change.doc.data() } as Task
          if (change.type === 'added' || change.type === 'modified') {
            setTasks(prev => {
              const idx = prev.findIndex(t => t.id === taskData.id)
              if (idx >= 0) {
                const next = [...prev]
                next[idx] = taskData
                return next
              }
              return [...prev, taskData]
            })
            setSelectedTask(prev => prev?.id === taskData.id ? taskData : prev)
          }
          if (change.type === 'removed') {
            setTasks(prev => prev.filter(t => t.id !== change.doc.id))
          }
        })
      },
      () => {}
    )
    return () => unsubscribe()
  }, [projectId])

  useEffect(() => {
    if (!deepLinkedTaskId) return
    const task = tasks.find(t => t.id === deepLinkedTaskId)
    if (!task) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setActiveTab('kanban')
      setSelectedTask(task)
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
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, columnId: newColumnId, order: newOrder } : t))
    await fetch(`/api/v1/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId: newColumnId, order: newOrder }),
    })
  }, [projectId])

  const handleTaskUpdate = useCallback(async (taskId: string, updates: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))
    setSelectedTask(prev => prev?.id === taskId ? { ...prev, ...updates } as Task : prev)
    await fetch(`/api/v1/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  }, [projectId])

  const handleTaskDelete = useCallback(async (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    await fetch(`/api/v1/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' })
  }, [projectId])

  const handleSaveSettings = async () => {
    if (!settingsName.trim()) return
    setSavingSettings(true)
    setSettingsSaved(false)
    await fetch(`/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: settingsName.trim(), status: settingsStatus, description: settingsDescription }),
    })
    setProject(prev => prev ? { ...prev, name: settingsName.trim(), status: settingsStatus, description: settingsDescription } : null)
    setSavingSettings(false)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2500)
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
    setTasks(prev => [...prev, task])
  }

  const columns = project?.columns?.length ? project.columns : DEFAULT_COLUMNS
  const selectedColumn = columns.find(c => c.id === selectedTask?.columnId)
  const composerColumn = columns.find(c => c.id === showNewTask) ?? null
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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 mb-3 md:mb-6">
        <div className="min-w-0">
          <div className="mb-1 flex min-w-0 items-center gap-2 overflow-hidden text-[11px] text-on-surface-variant md:text-xs">
            <Link href="/portal/projects" className="hover:text-on-surface transition-colors">Projects</Link>
            <span>/</span>
            <span className="truncate text-on-surface">{project?.name ?? '...'}</span>
          </div>
          <h1 className="truncate text-xl font-headline font-bold text-on-surface md:text-2xl">
            {loading ? '...' : project?.name}
          </h1>
        </div>
        {activeTab === 'kanban' && (
          <button
            onClick={() => setShowNewTask('todo')}
            className="pib-btn-primary shrink-0 px-3 py-2 text-xs font-label md:text-sm"
          >
            <span className="material-symbols-outlined text-[17px]">add_task</span>
            <span className="hidden sm:inline">New Task</span>
            <span className="sm:hidden">New</span>
          </button>
        )}
      </div>

      <PageTabs
        className="mb-3 shrink-0 md:mb-6"
        ariaLabel="Project detail tabs"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ProjectTab)}
        tabs={PROJECT_TABS.map((tab) => ({ label: tab.label, value: tab.id, icon: tab.icon }))}
      />

      {/* Tab Content */}
      {activeTab === 'kanban' && (
        <>
          <ProjectBoardSummary tasks={tasks} columns={columns} />

          <div className="mb-3 flex shrink-0 items-center justify-between gap-3 overflow-x-auto md:mb-4">
            <div className="inline-flex shrink-0 rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] p-1">
              {(['board', 'list'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs font-label capitalize ${
                    viewMode === mode
                      ? 'bg-[var(--color-accent-v2)] text-black'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{mode === 'board' ? 'view_kanban' : 'view_list'}</span>
                  {mode}
                </button>
              ))}
            </div>
            {viewMode === 'board' ? (
              <button
                type="button"
                onClick={() => setBoardSortMode(prev => prev === 'latest' ? 'manual' : 'latest')}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--color-card-border)] px-3 py-1.5 text-xs font-label uppercase tracking-wide text-on-surface-variant transition-colors hover:text-on-surface"
                aria-pressed={boardSortMode === 'manual'}
              >
                <span className="material-symbols-outlined text-[16px]">sort</span>
                {boardSortMode === 'latest' ? 'Manual order' : 'Latest first'}
              </button>
            ) : (
              <div className="inline-flex shrink-0 rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] p-1">
                {([
                  { key: 'latest', label: 'Latest first', icon: 'new_releases' },
                  { key: 'due', label: 'Due date', icon: 'event' },
                ] as const).map(option => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setTaskListSort(option.key)}
                    className={`inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs font-label ${
                      taskListSort === option.key
                        ? 'bg-[var(--color-accent-v2)] text-black'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                    aria-pressed={taskListSort === option.key}
                  >
                    <span className="material-symbols-outlined text-[16px]">{option.icon}</span>
                    <span className="hidden sm:inline">{option.label}</span>
                    <span className="sm:hidden">{option.key === 'latest' ? 'Latest' : 'Due'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Board */}
          {loading ? (
            <div className="flex gap-4 overflow-x-auto">
              {DEFAULT_COLUMNS.map(c => (
                <div key={c.id} className="w-72 shrink-0 space-y-2">
                  <Skeleton className="h-6 w-24" />
                  {[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}
                </div>
              ))}
            </div>
          ) : viewMode === 'list' ? (
            <div className="flex-1 overflow-auto rounded-[var(--radius-btn)] border border-[var(--color-card-border)]">
              <div data-testid="portal-mobile-task-list" className="space-y-2 p-2 md:hidden">
                {sortedListTasks.map(task => {
                  const assigneeIds = task.assigneeIds?.length ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : []
                  const people = [
                    ...assigneeIds.map(id => memberLabel(members.find(member => member.userId === id))),
                    task.assigneeAgentId ? agentLabel(agents.find(agent => agent.agentId === task.assigneeAgentId), task.assigneeAgentId) : '',
                  ].filter(Boolean).join(', ') || 'Unassigned'
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => setSelectedTask(task)}
                      className="w-full rounded-[var(--radius-card)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-3 text-left shadow-sm transition-colors hover:border-[var(--color-accent-v2)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-on-surface">{task.title}</p>
                          <p className="mt-1 truncate text-[11px] text-on-surface-variant">{people}</p>
                        </div>
                        <span className="shrink-0 rounded-full border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-2 py-1 text-[10px] text-on-surface-variant">
                          {columns.find(c => c.id === task.columnId)?.name ?? task.columnId}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-[11px] text-on-surface-variant">
                        <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">event</span>{formatDate(task.dueDate)}</span>
                        <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">schedule</span>{formatEstimate(task.estimateMinutes)}</span>
                        {(task.attachments?.length ?? 0) > 0 && <span className="ml-auto inline-flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">attach_file</span>{task.attachments?.length ?? 0}</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
              <table className="hidden w-full min-w-[760px] text-left text-sm md:table">
                <thead className="sticky top-0 bg-[var(--color-sidebar)] text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
                  <tr className="border-b border-[var(--color-card-border)]">
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
                    const assigneeIds = task.assigneeIds?.length ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : []
                    return (
                      <tr
                        key={task.id}
                        onClick={() => setSelectedTask(task)}
                        className="cursor-pointer border-b border-[var(--color-card-border)] bg-[var(--color-card)] hover:bg-[var(--color-surface-container)]"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-on-surface">{task.title}</p>
                          {task.labels?.length ? <p className="mt-1 text-xs text-on-surface-variant">{task.labels.join(', ')}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-on-surface-variant">{columns.find(c => c.id === task.columnId)?.name ?? task.columnId}</td>
                        <td className="px-4 py-3 text-on-surface-variant">
                          {[
                            ...assigneeIds.map(id => memberLabel(members.find(member => member.userId === id))),
                            task.assigneeAgentId ? agentLabel(agents.find(agent => agent.agentId === task.assigneeAgentId), task.assigneeAgentId) : '',
                          ].filter(Boolean).join(', ') || 'Unassigned'}
                        </td>
                        <td className="px-4 py-3 text-on-surface-variant">{formatDate(task.dueDate)}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{formatEstimate(task.estimateMinutes)}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{task.attachments?.length ?? 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <KanbanBoard
                columns={columns}
                tasks={tasks}
                members={members}
                agents={agents}
                sortMode={boardSortMode}
                onSortModeChange={setBoardSortMode}
                showSortToggle={false}
                onTaskMove={handleTaskMove}
                onTaskClick={setSelectedTask}
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
        <ProjectSuitePanel projectId={projectId} />
      )}

      {activeTab === 'settings' && (
        <ProjectSettingsPanel
          name={settingsName}
          status={settingsStatus}
          description={settingsDescription}
          saving={savingSettings}
          saved={settingsSaved}
          onNameChange={setSettingsName}
          onStatusChange={setSettingsStatus}
          onDescriptionChange={setSettingsDescription}
          onSave={handleSaveSettings}
          peopleAccessSlot={<ProjectPeopleAccessPanel projectId={projectId} />}
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
          hideAgentSection
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
        hideAgentSection
        onClose={() => setShowNewTask(null)}
        onCreated={handleTaskCreated}
      />
    </div>
  )
}
