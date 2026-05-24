'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { TaskDetailPanel } from '@/components/kanban/TaskDetailPanel'
import { TaskComposer } from '@/components/kanban/TaskComposer'
import type { AgentMember, Column, Task, TeamMember } from '@/components/kanban/types'

interface ProjectDoc { id: string; title: string; content: string; type: 'brief' | 'requirements' | 'notes' | 'reference'; createdBy: string; updatedBy?: string; createdAt?: unknown; updatedAt?: unknown }
interface Project { id: string; orgId?: string; name: string; description?: string; brief?: string; status?: string; columns: Column[] }
type TaskListSort = 'latest' | 'due'

const DEFAULT_COLUMNS: Column[] = [
  { id: 'backlog',     name: 'Backlog',     color: 'var(--color-outline)',    order: 0 },
  { id: 'todo',        name: 'To Do',       color: '#60a5fa',                 order: 1 },
  { id: 'in_progress', name: 'In Progress', color: 'var(--color-accent-v2)', order: 2 },
  { id: 'blocked',     name: 'Blocked',     color: '#ef4444',                 order: 3 },
  { id: 'review',      name: 'Review',      color: '#c084fc',                 order: 4 },
  { id: 'done',        name: 'Done',        color: '#4ade80',                 order: 5 },
]

const TYPE_COLORS: Record<string, string> = {
  brief: 'bg-amber-50 text-amber-700 border-amber-200',
  requirements: 'bg-blue-50 text-blue-700 border-blue-200',
  notes: 'bg-gray-50 text-gray-700 border-gray-200',
  reference: 'bg-purple-50 text-purple-700 border-purple-200',
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
  const projectId = params.projectId as string

  const [project, setProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [docs, setDocs] = useState<ProjectDoc[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [agents, setAgents] = useState<AgentMember[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showNewTask, setShowNewTask] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'kanban' | 'docs' | 'settings'>('kanban')
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')
  const [taskListSort, setTaskListSort] = useState<TaskListSort>('latest')
  const [editingBrief, setEditingBrief] = useState(false)
  const [briefValue, setBriefValue] = useState('')
  const [editingDoc, setEditingDoc] = useState<ProjectDoc | null>(null)
  const [savingBrief, setSavingBrief] = useState(false)
  const [settingsName, setSettingsName] = useState('')
  const [settingsStatus, setSettingsStatus] = useState('discovery')
  const [settingsDescription, setSettingsDescription] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/v1/projects/${projectId}`).then(r => r.json()),
      fetch(`/api/v1/projects/${projectId}/tasks`).then(r => r.json()),
      fetch(`/api/v1/projects/${projectId}/docs`).then(r => r.json()),
    ]).then(([pBody, tBody, dBody]) => {
      setProject(pBody.data)
      setTasks(tBody.data ?? [])
      setDocs(dBody.data ?? [])
      setBriefValue(pBody.data?.brief ?? '')
      setSettingsName(pBody.data?.name ?? '')
      setSettingsStatus(pBody.data?.status ?? 'discovery')
      setSettingsDescription(pBody.data?.description ?? '')
      setLoading(false)
    }).catch(() => setLoading(false))
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
    } else {
      const res = await fetch(`/api/v1/projects/${projectId}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editingDoc.title, content: editingDoc.content, type: editingDoc.type }),
      })
      const body = await res.json()
      if (body.data?.id) {
        setDocs(prev => [{ ...editingDoc, id: body.data.id } as ProjectDoc, ...prev])
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
  const blockedCount = tasks.filter(t => t.labels?.some(label => label.toLowerCase() === 'blocked')).length
  const mediaCount = tasks.reduce((sum, task) => sum + (task.attachments?.length ?? 0), 0)
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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <div className="flex items-center gap-2 text-xs text-on-surface-variant mb-1">
            <Link href="/portal/projects" className="hover:text-on-surface transition-colors">Projects</Link>
            <span>/</span>
            <span className="text-on-surface">{project?.name ?? '...'}</span>
          </div>
          <h1 className="text-2xl font-headline font-bold text-on-surface">
            {loading ? '...' : project?.name}
          </h1>
        </div>
        {activeTab === 'kanban' && (
          <button
            onClick={() => setShowNewTask('todo')}
            className="pib-btn-primary text-sm font-label"
          >
            <span className="material-symbols-outlined text-[17px]">add_task</span>
            New Task
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-6 mb-6 shrink-0 border-b border-[var(--color-outline)]">
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
          <div className="mb-4 grid shrink-0 gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-3">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Tasks</p>
              <p className="mt-1 text-2xl font-headline font-bold text-on-surface">{tasks.length}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-3">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Due soon</p>
              <p className="mt-1 text-2xl font-headline font-bold text-on-surface">{dueSoonCount}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-3">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Media</p>
              <p className="mt-1 text-2xl font-headline font-bold text-on-surface">{mediaCount}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-3">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Done / blocked</p>
              <p className="mt-1 text-2xl font-headline font-bold text-on-surface">{doneCount}<span className="text-on-surface-variant"> / {blockedCount}</span></p>
            </div>
          </div>

          <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
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
                    {option.label}
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
              <table className="w-full min-w-[760px] text-left text-sm">
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
        <div className="flex-1 overflow-auto space-y-6">
          {/* Brief Section */}
          <div className="bg-[var(--color-card)] border border-[var(--color-outline)] rounded-lg p-4">
            <h2 className="text-lg font-headline font-bold text-on-surface mb-3">Project Brief</h2>
            {editingBrief ? (
              <div className="space-y-3">
                <textarea
                  value={briefValue}
                  onChange={e => setBriefValue(e.target.value)}
                  placeholder="Add a project brief... What's this project about? Goals, constraints, key stakeholders."
                  className="w-full px-3 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-outline)] rounded text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-[var(--color-accent-v2)]"
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
              <div className="space-y-3">
                <p className={`px-3 py-2 text-sm rounded min-h-[80px] ${briefValue ? 'bg-[var(--color-background)] text-on-surface' : 'bg-[var(--color-background)] text-on-surface-variant italic'}`}>
                  {briefValue || 'No brief yet'}
                </p>
                <button onClick={() => setEditingBrief(true)} className="pib-btn-secondary text-sm font-label">Edit</button>
              </div>
            )}
          </div>

          {/* Documents Section */}
          <div className="bg-[var(--color-card)] border border-[var(--color-outline)] rounded-lg p-4">
            <h2 className="text-lg font-headline font-bold text-on-surface mb-4">Documents</h2>
            {editingDoc ? (
              <div className="space-y-3 mb-4">
                <input
                  type="text"
                  placeholder="Document title..."
                  value={editingDoc.title}
                  onChange={e => setEditingDoc({ ...editingDoc, title: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-outline)] rounded text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
                />
                <select
                  value={editingDoc.type}
                  onChange={e => setEditingDoc({ ...editingDoc, type: e.target.value as ProjectDoc['type'] })}
                  className="w-full px-3 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-outline)] rounded text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
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
                  className="w-full px-3 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-outline)] rounded text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-[var(--color-accent-v2)]"
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
                <div className="space-y-2 mb-4">
                  {docs.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between p-3 bg-[var(--color-background)] border border-[var(--color-outline)] rounded">
                      <div className="flex-1 flex items-center gap-3">
                        <span className="text-lg">📄</span>
                        <div>
                          <p className="text-sm font-semibold text-on-surface">{doc.title}</p>
                          <span className={`inline-block text-xs px-2 py-1 rounded border mt-1 ${TYPE_COLORS[doc.type] || TYPE_COLORS.notes}`}>
                            {doc.type}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setEditingDoc(doc)} className="pib-btn-secondary text-xs font-label">Edit</button>
                        <button onClick={() => handleDeleteDoc(doc.id!)} className="text-xs text-red-600 hover:text-red-700">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setEditingDoc({ id: '', title: '', content: '', type: 'notes', createdBy: '' })}
                  className="w-full pib-btn-secondary text-sm font-label"
                >
                  + New Document
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="flex-1 overflow-auto max-w-2xl">
          <div className="bg-[var(--color-card)] border border-[var(--color-outline)] rounded-lg p-6 space-y-6">
            <div>
              <label className="block text-sm font-semibold text-on-surface mb-2">Project Name</label>
              <input
                type="text"
                value={settingsName}
                onChange={e => setSettingsName(e.target.value)}
                className="w-full px-4 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-outline)] rounded text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-on-surface mb-2">Status</label>
              <select
                value={settingsStatus}
                onChange={e => setSettingsStatus(e.target.value)}
                className="w-full px-4 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-outline)] rounded text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
              >
                <option value="discovery">Discovery</option>
                <option value="design">Design</option>
                <option value="development">Development</option>
                <option value="review">Review</option>
                <option value="live">Live</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-on-surface mb-2">Description</label>
              <textarea
                value={settingsDescription}
                onChange={e => setSettingsDescription(e.target.value)}
                className="w-full px-4 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-outline)] rounded text-on-surface focus:outline-none focus:border-[var(--color-accent-v2)]"
                rows={4}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings || !settingsName.trim()}
                className="pib-btn-primary text-sm font-label"
              >
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
              {settingsSaved && (
                <span className="text-xs text-green-400">Saved</span>
              )}
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
