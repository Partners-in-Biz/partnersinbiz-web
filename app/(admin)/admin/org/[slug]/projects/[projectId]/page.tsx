'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { collection, onSnapshot } from 'firebase/firestore'
import { getClientDb } from '@/lib/firebase/config'
import Link from 'next/link'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { TaskDetailPanel } from '@/components/kanban/TaskDetailPanel'
import { TaskComposer } from '@/components/kanban/TaskComposer'
import HermesChat from '@/components/hermes/Chat'
import type { AgentMember, Column, Task, TeamMember } from '@/components/kanban/types'

interface ProjectDoc { id: string; title: string; content: string; type: 'brief' | 'requirements' | 'notes' | 'reference'; createdBy: string; updatedBy?: string; createdAt?: unknown; updatedAt?: unknown }
interface Project { id: string; orgId?: string; name: string; description?: string; brief?: string; status?: string; columns: Column[] }
type TaskListSort = 'latest' | 'due'

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

const TYPE_COLORS: Record<string, string> = {
  brief: 'border-[var(--color-accent-v2)] bg-[var(--color-surface-container)] text-on-surface',
  requirements: 'border-[var(--color-accent-v2)] bg-[var(--color-surface-container)] text-on-surface',
  notes: 'border-[var(--color-card-border)] bg-[var(--color-card)] text-on-surface-variant',
  reference: 'border-[var(--color-card-border)] bg-[var(--color-card)] text-on-surface-variant',
}

function docPreview(content: string): string {
  const preview = content.replace(/\s+/g, ' ').trim()
  if (!preview) return 'No preview content yet.'
  return preview.length > 180 ? `${preview.slice(0, 180).trim()}…` : preview
}

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

function isDueThisWeek(task: Task): boolean {
  const due = timestampToMillis(task.dueDate)
  if (!due) return false
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const nextWeek = new Date(now)
  nextWeek.setDate(now.getDate() + 7)
  return due >= now.getTime() && due <= nextWeek.getTime()
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

export default function ProjectDetailPage() {
  const params = useParams()
  const slug = params.slug as string
  const projectId = params.projectId as string

  const [project, setProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [docs, setDocs] = useState<ProjectDoc[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [agents, setAgents] = useState<AgentMember[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showNewTask, setShowNewTask] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'kanban' | 'docs' | 'agent' | 'settings'>('kanban')
  const [viewMode, setViewMode] = useState<'board' | 'list'>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'board'
    return window.matchMedia('(max-width: 767px)').matches ? 'list' : 'board'
  })
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
      setSettingsDescription(pBody.data?.description ?? '')
      setLoading(false)
    }).catch(() => setLoading(false))

    // Initial tasks load via REST — always reliable regardless of client auth
    fetch(`/api/v1/projects/${projectId}/tasks`).then(r => r.json())
      .then(body => setTasks(prev => mergeLiveTasks(body.data ?? [], prev)))
      .catch(() => {})

    // Live patches via Firestore — only applies incremental changes on top of
    // REST data, so if the listener fails or has no auth the board still shows.
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
      () => {} // silent fail — REST data already loaded
    )
    return () => unsubscribe()
  }, [projectId])

  useEffect(() => {
    if (!project?.orgId) return
    fetch(`/api/v1/organizations/${project.orgId}/members`)
      .then(r => r.json())
      .then(body => setMembers(body.data ?? []))
      .catch(() => setMembers([]))
    fetch(`/api/v1/orgs/${project.orgId}/visible-agents`)
      .then(r => r.json())
      .then(body => setAgents(body.data ?? []))
      .catch(() => setAgents([]))
  }, [project?.orgId])

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
    if (!window.confirm('Are you sure?')) return
    await fetch(`/api/v1/projects/${projectId}/docs/${docId}`, { method: 'DELETE' })
    setDocs(prev => prev.filter(d => d.id !== docId))
    setSelectedDoc(prev => prev?.id === docId ? null : prev)
  }

  const handleSaveDoc = async () => {
    if (!editingDoc?.title.trim() || !editingDoc?.content.trim()) return

    if (editingDoc.id) {
      await fetch(`/api/v1/projects/${projectId}/docs/${editingDoc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editingDoc.title, content: editingDoc.content, type: editingDoc.type }),
      })
      setDocs(prev => prev.map(d => d.id === editingDoc.id ? editingDoc : d))
      setSelectedDoc(prev => prev?.id === editingDoc.id ? editingDoc : prev)
    } else {
      const res = await fetch(`/api/v1/projects/${projectId}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editingDoc.title, content: editingDoc.content, type: editingDoc.type }),
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
  const doneCount = tasks.filter(t => t.columnId === 'done').length
  const blockedCount = tasks.filter(t => t.columnId === 'blocked' || t.labels?.some(label => label.toLowerCase() === 'blocked')).length
  const dueSoonCount = tasks.filter(isDueThisWeek).length
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
    <div className="h-full flex flex-col min-w-0">
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 mb-3 md:mb-6">
        <div className="min-w-0">
          <div className="mb-1 flex min-w-0 items-center gap-2 overflow-hidden text-[11px] text-on-surface-variant md:text-xs">
            <Link href={`/admin/org/${slug}/projects`} className="hover:text-on-surface transition-colors">Projects</Link>
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

      {/* Tabs */}
      <div className="mb-3 flex shrink-0 gap-4 overflow-x-auto border-b border-[var(--color-outline)] md:mb-6 md:gap-6">
        <button
          onClick={() => setActiveTab('kanban')}
          className={`px-1 pb-3 text-sm font-label transition-colors ${
            activeTab === 'kanban'
              ? 'text-on-surface border-b-2 border-[var(--color-accent-v2)]'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          Kanban
        </button>
        <button
          onClick={() => setActiveTab('docs')}
          className={`px-1 pb-3 text-sm font-label transition-colors ${
            activeTab === 'docs'
              ? 'text-on-surface border-b-2 border-[var(--color-accent-v2)]'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          Docs
        </button>
        <button
          onClick={() => setActiveTab('agent')}
          className={`px-1 pb-3 text-sm font-label transition-colors flex items-center gap-1.5 ${
            activeTab === 'agent'
              ? 'text-on-surface border-b-2 border-[var(--color-accent-v2)]'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">smart_toy</span>
          Agent
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-1 pb-3 text-sm font-label transition-colors ${
            activeTab === 'settings'
              ? 'text-on-surface border-b-2 border-[var(--color-accent-v2)]'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          Settings
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'kanban' && (
        <>
          <div className="mb-3 grid shrink-0 grid-cols-2 gap-2 md:mb-4 md:grid-cols-4 md:gap-3">
            {[
              { label: 'Tasks', value: tasks.length },
              { label: 'Due', value: dueSoonCount },
              { label: 'Blocked', value: blockedCount },
              { label: 'Done', value: doneCount },
            ].map(stat => (
              <div key={stat.label} className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-3 shadow-sm">
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{stat.label}</p>
                <p className="mt-1 text-2xl font-headline font-bold text-on-surface">{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="mb-3 flex shrink-0 items-center justify-between gap-3 md:mb-4">
            <div className="inline-flex rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] p-1">
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
            {viewMode === 'list' && (
              <div className="inline-flex rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] p-1">
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
            <div className="flex-1 overflow-auto rounded-lg border border-[var(--color-card-border)]">
              <div className="space-y-2 p-2 md:hidden">
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
                      className="w-full rounded-xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-3 text-left shadow-sm transition-colors hover:border-[var(--color-accent-v2)]"
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
                onTaskMove={handleTaskMove}
                onTaskClick={setSelectedTask}
                onAddTask={(columnId) => setShowNewTask(columnId)}
              />
            </div>
          )}
        </>
      )}

      {activeTab === 'docs' && (
        <div className="flex-1 overflow-auto space-y-6 pb-6">
          <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Project docs</p>
                <h2 className="mt-1 text-2xl font-headline font-bold text-on-surface">Brief and knowledge base</h2>
                <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">Keep project context close to the board. Open any document to preview it before editing.</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingDoc({ id: '', title: '', content: '', type: 'notes', createdBy: '' })}
                className="pib-btn-primary text-sm font-label"
              >
                <span className="material-symbols-outlined text-[17px]">note_add</span>
                New Document
              </button>
            </div>
          </div>

          {/* Brief Section */}
          <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Source of truth</p>
                <h2 className="mt-1 text-lg font-headline font-bold text-on-surface">Project Brief</h2>
              </div>
              {!editingBrief && (
                <button onClick={() => setEditingBrief(true)} className="pib-btn-secondary text-sm font-label">Edit brief</button>
              )}
            </div>
            {editingBrief ? (
              <div className="space-y-3">
                <textarea
                  value={briefValue}
                  onChange={e => setBriefValue(e.target.value)}
                  placeholder="Add a project brief... What's this project about? Goals, constraints, key stakeholders."
                  className="w-full rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-[var(--color-accent-v2)]"
                  rows={4}
                />
                <div className="flex gap-2">
                  <button onClick={handleSaveBrief} disabled={savingBrief} className="pib-btn-primary text-sm font-label">
                    {savingBrief ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={() => { setEditingBrief(false); setBriefValue(project?.brief ?? ''); }} className="pib-btn-secondary text-sm font-label">Cancel</button>
                </div>
              </div>
            ) : (
              <div>
                <p className={`min-h-[96px] whitespace-pre-wrap rounded-xl border border-[var(--color-card-border)] px-4 py-3 text-sm leading-6 ${briefValue ? 'bg-[var(--color-background)] text-on-surface' : 'bg-[var(--color-background)] text-on-surface-variant italic'}`}>
                  {briefValue || 'No brief yet'}
                </p>
              </div>
            )}
          </div>

          {/* Documents Section */}
          <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Library</p>
                <h2 className="mt-1 text-lg font-headline font-bold text-on-surface">Documents</h2>
              </div>
              <span className="rounded-full border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-1 text-xs text-on-surface-variant">{docs.length} docs</span>
            </div>
            {editingDoc ? (
              <div className="mb-4 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-4 space-y-3">
                <input
                  type="text"
                  placeholder="Document title..."
                  value={editingDoc.title}
                  onChange={e => setEditingDoc({ ...editingDoc, title: e.target.value })}
                  className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
                />
                <select
                  value={editingDoc.type}
                  onChange={e => setEditingDoc({ ...editingDoc, type: e.target.value as ProjectDoc['type'] })}
                  className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
                >
                  <option value="brief">Brief</option>
                  <option value="requirements">Requirements</option>
                  <option value="notes">Notes</option>
                  <option value="reference">Reference</option>
                </select>
                <textarea
                  placeholder="Content (markdown)..."
                  value={editingDoc.content}
                  onChange={e => setEditingDoc({ ...editingDoc, content: e.target.value })}
                  className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-[var(--color-accent-v2)]"
                  rows={10}
                />
                <div className="flex gap-2">
                  <button onClick={handleSaveDoc} className="pib-btn-primary text-sm font-label">Save</button>
                  <button onClick={() => setEditingDoc(null)} className="pib-btn-secondary text-sm font-label">Cancel</button>
                </div>
              </div>
            ) : null}

            {!editingDoc && (
              <>
                {docs.length ? (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
                    <div className="space-y-3">
                      {docs.map(doc => (
                        <div key={doc.id} className={`rounded-xl border bg-[var(--color-background)] p-1 transition-colors ${selectedDoc?.id === doc.id ? 'border-[var(--color-accent-v2)]' : 'border-[var(--color-card-border)] hover:border-[var(--color-outline)]'}`}>
                          <button
                            type="button"
                            onClick={() => setSelectedDoc(doc)}
                            className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left"
                            aria-label={`Preview ${doc.title}`}
                          >
                            <span className="material-symbols-outlined mt-0.5 text-[22px] text-on-surface-variant">description</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-on-surface">{doc.title}</span>
                              <span className="mt-2 block text-xs leading-5 text-on-surface-variant">{docPreview(doc.content)}</span>
                              <span className={`mt-3 inline-block rounded-full border px-2.5 py-1 text-[10px] font-label uppercase tracking-widest ${TYPE_COLORS[doc.type] || TYPE_COLORS.notes}`}>
                                {doc.type}
                              </span>
                            </span>
                          </button>
                          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-card-border)] px-3 py-2">
                            <button onClick={() => setEditingDoc(doc)} className="pib-btn-secondary text-xs font-label">Edit</button>
                            <button onClick={() => handleDeleteDoc(doc.id!)} className="text-xs font-label text-red-400 hover:text-red-300">Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="min-h-[320px] rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-5">
                      {selectedDoc ? (
                        <div className="space-y-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <span className={`inline-block rounded-full border px-2.5 py-1 text-[10px] font-label uppercase tracking-widest ${TYPE_COLORS[selectedDoc.type] || TYPE_COLORS.notes}`}>{selectedDoc.type}</span>
                              <h3 className="mt-3 text-xl font-headline font-bold text-on-surface">{selectedDoc.title}</h3>
                              <p className="mt-1 text-xs text-on-surface-variant">Updated {formatDate(selectedDoc.updatedAt ?? selectedDoc.createdAt)}</p>
                            </div>
                            <button onClick={() => setEditingDoc(selectedDoc)} className="pib-btn-secondary text-xs font-label">Edit</button>
                          </div>
                          <div className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-4 text-sm leading-6 text-on-surface">
                            {selectedDoc.content || 'This document is empty.'}
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
                          <span className="material-symbols-outlined text-[40px] text-on-surface-variant">preview</span>
                          <h3 className="mt-3 text-base font-headline font-bold text-on-surface">Select a document</h3>
                          <p className="mt-2 max-w-xs text-sm text-on-surface-variant">Click a document on the left to open its preview here.</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[var(--color-card-border)] bg-[var(--color-background)] p-8 text-center">
                    <span className="material-symbols-outlined text-[40px] text-on-surface-variant">draft</span>
                    <h3 className="mt-3 text-base font-headline font-bold text-on-surface">No documents yet</h3>
                    <p className="mt-2 text-sm text-on-surface-variant">Create the first project note, brief, requirement, or reference doc.</p>
                    <button
                      onClick={() => setEditingDoc({ id: '', title: '', content: '', type: 'notes', createdBy: '' })}
                      className="pib-btn-secondary mt-4 text-sm font-label"
                    >
                      New Document
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'agent' && (
        <div className="flex-1 overflow-auto">
          <HermesChat
            orgId={project?.orgId ?? ''}
            profileEnabled={Boolean(project?.orgId)}
            projectId={projectId}
            projectName={project?.name}
          />
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="flex-1 overflow-auto pb-6">
          <div className="max-w-4xl space-y-6">
            <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-sm">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Project settings</p>
              <h2 className="mt-1 text-2xl font-headline font-bold text-on-surface">Manage this board</h2>
              <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">Update the client-facing project details while keeping the same polished board styling.</p>
            </div>
            <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-5 shadow-sm">
              <div className="grid gap-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label htmlFor="project-settings-name" className="block text-xs font-label uppercase tracking-widest text-on-surface-variant mb-2">Project Name</label>
                  <input
                    id="project-settings-name"
                    type="text"
                    value={settingsName}
                    onChange={e => setSettingsName(e.target.value)}
                    className="w-full rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
                  />
                </div>
                <div>
                  <label htmlFor="project-settings-status" className="block text-xs font-label uppercase tracking-widest text-on-surface-variant mb-2">Status</label>
                  <select
                    id="project-settings-status"
                    value={settingsStatus}
                    onChange={e => setSettingsStatus(e.target.value)}
                    className="w-full rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
                  >
                    <option value="discovery">Discovery</option>
                    <option value="design">Design</option>
                    <option value="development">Development</option>
                    <option value="review">Review</option>
                    <option value="live">Live</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </div>
                <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
                  <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Current board</p>
                  <p className="mt-2 text-lg font-headline font-bold text-on-surface">{settingsName || project?.name || 'Untitled project'}</p>
                  <p className="mt-1 text-sm capitalize text-on-surface-variant">{settingsStatus.replace(/_/g, ' ')}</p>
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="project-settings-description" className="block text-xs font-label uppercase tracking-widest text-on-surface-variant mb-2">Description</label>
                  <textarea
                    id="project-settings-description"
                    value={settingsDescription}
                    onChange={e => setSettingsDescription(e.target.value)}
                    className="w-full rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
                    rows={5}
                  />
                </div>
              </div>
              <div className="mt-6 flex items-center gap-3 border-t border-[var(--color-card-border)] pt-5">
                <button
                  onClick={handleSaveSettings}
                  disabled={savingSettings || !settingsName.trim()}
                  className="pib-btn-primary text-sm font-label"
                >
                  {savingSettings ? 'Saving...' : 'Save Settings'}
                </button>
                {settingsSaved && (
                  <span className="rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 text-xs text-green-300">Saved</span>
                )}
              </div>
            </div>
          </div>
        </div>
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
        onClose={() => setShowNewTask(null)}
        onCreated={handleTaskCreated}
      />
    </div>
  )
}

