'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { uploadTaskFile } from './TaskComposer'
import type { AgentId, AgentMember, Attachment, ChecklistItem, Task, TeamMember } from './types'

interface Comment {
  id?: string
  text: string
  userId: string
  userName: string
  userRole: 'admin' | 'client' | 'ai'
  createdAt: { _seconds: number; _nanoseconds: number }
  agentPickedUp: boolean
  agentPickedUpAt?: unknown
}

interface TaskDetailPanelProps {
  task: Task | null
  columnName: string
  projectId: string
  orgId?: string
  members?: TeamMember[]
  agents?: AgentMember[]
  hideAgentSection?: boolean
  onClose: () => void
  onUpdate: (taskId: string, updates: Partial<Task>) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
}

const PRIORITIES = ['urgent', 'high', 'medium', 'low']
type AssignmentMode = 'people' | 'agent' | 'orchestration'
const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef4444',
  high: 'var(--color-accent-v2)',
  medium: '#60a5fa',
  normal: '#60a5fa',
  low: 'var(--color-outline)',
}

function cleanList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function dateInputValue(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().toISOString().slice(0, 10)
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString().slice(0, 10)
  }
  return ''
}

function memberLabel(member?: TeamMember): string {
  return member?.displayName || member?.email || 'Unknown'
}

function agentLabel(agent?: AgentMember, agentId?: string | null): string {
  return agent?.name || agentId || 'Agent'
}

function activeAgents(agents: AgentMember[]): AgentMember[] {
  return agents.filter((agent) => agent.enabled !== false)
}

function isOrchestrationTask(task?: Task | null): boolean {
  return task?.agentInput?.context?.orchestrationMode === 'pip-orchestrator'
}

function assignmentModeForTask(task?: Task | null): AssignmentMode {
  if (isOrchestrationTask(task)) return 'orchestration'
  if (task?.assigneeAgentId) return 'agent'
  return 'people'
}

function buildAgentSpec(title: string, description: string, checklist: ChecklistItem[]): string {
  return [
    title.trim(),
    description.trim(),
    checklist.length ? `Checklist:\n${checklist.map((item) => `- ${item.text}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

function formatSize(size?: number): string {
  if (!size) return ''
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function isAgentStale(heartbeatAt: unknown, staleMinutes = 5): boolean {
  if (!heartbeatAt) return false
  let ms: number | null = null
  if (typeof heartbeatAt === 'object' && heartbeatAt !== null) {
    const h = heartbeatAt as { seconds?: number; _seconds?: number; toDate?: () => Date }
    if (typeof h.toDate === 'function') ms = h.toDate().getTime()
    else if (typeof h.seconds === 'number') ms = h.seconds * 1000
    else if (typeof h._seconds === 'number') ms = h._seconds * 1000
  }
  if (ms === null) return false
  return Date.now() - ms > staleMinutes * 60 * 1000
}

export function TaskDetailPanel({ task, columnName, projectId, orgId, members = [], agents = [], hideAgentSection = false, onClose, onUpdate, onDelete }: TaskDetailPanelProps) {
  const router = useRouter()
  const pathname = usePathname()
  // Extract org slug from current URL: /admin/org/[slug]/...
  const orgSlug = pathname.split('/').find((_, i, arr) => arr[i - 1] === 'org') ?? null
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [labelsText, setLabelsText] = useState(task?.labels?.join(', ') ?? '')
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task?.assigneeIds ?? (task?.assigneeId ? [task.assigneeId] : []))
  const [assigneeAgentId, setAssigneeAgentId] = useState<AgentId | ''>((task?.assigneeAgentId as AgentId | null) ?? '')
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>(assignmentModeForTask(task))
  const [mentionIds, setMentionIds] = useState<string[]>(task?.mentionIds ?? [])
  const [reviewerIds, setReviewerIds] = useState<string[]>(task?.reviewerIds ?? [])
  const [reviewerAgentId, setReviewerAgentId] = useState<AgentId | ''>((task?.reviewerAgentId as AgentId | null) ?? '')
  const [dueDate, setDueDate] = useState(dateInputValue(task?.dueDate))
  const [startDate, setStartDate] = useState(dateInputValue(task?.startDate))
  const [estimateHours, setEstimateHours] = useState(task?.estimateMinutes ? String(task.estimateMinutes / 60) : '')
  const [checklist, setChecklist] = useState<ChecklistItem[]>(task?.checklist ?? [])
  const [saving, setSaving] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentText, setCommentText] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [loadingComments, setLoadingComments] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>(task?.attachments ?? [])
  const [showAddAttachment, setShowAddAttachment] = useState(false)
  const [attachmentUrl, setAttachmentUrl] = useState('')
  const [attachmentName, setAttachmentName] = useState('')
  const [savingAttachment, setSavingAttachment] = useState(false)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [newChecklistItem, setNewChecklistItem] = useState('')
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [showRevisionForm, setShowRevisionForm] = useState(false)
  const [revisionNote, setRevisionNote] = useState('')
  const [submittingRevision, setSubmittingRevision] = useState(false)

  useEffect(() => {
    setEditing(false)
    setTitle(task?.title ?? '')
    setDescription(task?.description ?? '')
    setLabelsText(task?.labels?.join(', ') ?? '')
    setAssigneeIds(task?.assigneeIds ?? (task?.assigneeId ? [task.assigneeId] : []))
    setAssigneeAgentId((task?.assigneeAgentId as AgentId | null) ?? '')
    setAssignmentMode(assignmentModeForTask(task))
    setMentionIds(task?.mentionIds ?? [])
    setReviewerIds(task?.reviewerIds ?? [])
    setReviewerAgentId((task?.reviewerAgentId as AgentId | null) ?? '')
    setDueDate(dateInputValue(task?.dueDate))
    setStartDate(dateInputValue(task?.startDate))
    setEstimateHours(task?.estimateMinutes ? String(task.estimateMinutes / 60) : '')
    setChecklist(task?.checklist ?? [])
    setAttachments(task?.attachments ?? [])
    setAttachmentError(null)
  }, [task?.id, task])

  // Fetch comments when task changes
  useEffect(() => {
    if (!task?.id || !projectId) return

    setLoadingComments(true)
    fetch(`/api/v1/projects/${projectId}/tasks/${task.id}/comments`)
      .then(r => r.json())
      .then(body => {
        if (body.success && Array.isArray(body.data)) {
          setComments(body.data)
        }
      })
      .catch(err => console.error('Failed to fetch comments:', err))
      .finally(() => setLoadingComments(false))
  }, [task?.id, projectId])

  if (!task) return null

  async function handleSave() {
    if (!task) return
    setSaving(true)
    const estimate = Number.parseFloat(estimateHours)
    const effectiveMode = hideAgentSection ? 'people' : assignmentMode
    const agentId = effectiveMode === 'orchestration' ? 'pip' : effectiveMode === 'agent' ? assigneeAgentId : ''
    const peopleIds = effectiveMode === 'people' ? assigneeIds : []
    const selectedMentionIds = effectiveMode === 'people' ? mentionIds : []
    const spec = buildAgentSpec(title, description, checklist)
    await onUpdate(task.id, {
      title: title.trim(),
      description: description.trim(),
      labels: cleanList(labelsText),
      assigneeId: peopleIds[0] ?? null,
      assigneeIds: peopleIds,
      assigneeAgentId: agentId || null,
      agentInput: agentId
        ? {
            spec,
            context: {
              projectId,
              orgId: orgId ?? null,
              columnId: task.columnId,
              assignmentMode: effectiveMode,
              ...(effectiveMode === 'orchestration'
                ? {
                    orchestrationMode: 'pip-orchestrator',
                    requestedAgentIds: activeAgents(agents).map((agent) => agent.agentId).filter((id) => id !== 'pip'),
                  }
                : {}),
            },
            ...(effectiveMode === 'orchestration'
              ? {
                  constraints: [
                    'Pip owns orchestration for this task.',
                    'Break the work into agent-ready subtasks when needed and route them to the right agents.',
                  ],
                }
              : {}),
          }
        : null,
      mentionIds: selectedMentionIds,
      reviewerIds,
      reviewerAgentId: reviewerAgentId || null,
      dueDate: dueDate || null,
      startDate: startDate || null,
      estimateMinutes: Number.isFinite(estimate) && estimate > 0 ? Math.round(estimate * 60) : null,
    })
    setSaving(false)
    setEditing(false)
  }

  async function handleDelete() {
    if (!task) return
    if (!confirm('Delete this task?')) return
    await onDelete(task.id)
    onClose()
  }

  async function handleRequestRevision() {
    if (!revisionNote.trim() || !task?.id || !projectId) return
    setSubmittingRevision(true)
    try {
      // Post the rejection comment so there's a visible audit trail
      const res = await fetch(`/api/v1/projects/${projectId}/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `❌ Revision requested: ${revisionNote.trim()}` }),
      })
      const body = await res.json()
      if (body.success && body.data) setComments(prev => [...prev, body.data])

      // Re-queue the agent with the rejection reason appended to the spec
      const existingSpec = task.agentInput?.spec ?? ''
      const updatedSpec = existingSpec
        ? `${existingSpec}\n\n---\nRevision requested: ${revisionNote.trim()}`
        : `Revision requested: ${revisionNote.trim()}`

      await onUpdate(task.id, {
        columnId: 'todo',
        agentStatus: 'pending',
        reviewStatus: 'changes-requested',
        agentInput: { ...task.agentInput, spec: updatedSpec },
      })

      setRevisionNote('')
      setShowRevisionForm(false)
    } catch (err) {
      console.error('Failed to request revision:', err)
    } finally {
      setSubmittingRevision(false)
    }
  }

  async function handleRetryTask() {
    if (!task?.id) return
    await onUpdate(task.id, {
      columnId: 'todo',
      agentStatus: task.assigneeAgentId ? 'pending' : task.agentStatus,
      reviewStatus: null,
    })
  }

  async function handleApproveReview() {
    if (!task?.id) return
    await onUpdate(task.id, {
      columnId: 'done',
      reviewStatus: 'approved',
    })
  }

  async function handleSubmitComment() {
    if (!commentText.trim() || !task?.id || !projectId) return

    setSubmittingComment(true)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: commentText.trim() }),
      })
      const body = await res.json()
      if (body.success && body.data) {
        setComments(prev => [...prev, body.data])
        setCommentText('')
      }
    } catch (err) {
      console.error('Failed to submit comment:', err)
    } finally {
      setSubmittingComment(false)
    }
  }

  async function handleAddAttachment() {
    if (!attachmentUrl.trim() || !task?.id || !projectId) return

    setSavingAttachment(true)
    try {
      const name = attachmentName.trim() || extractNameFromUrl(attachmentUrl)
      const newAttachment: Attachment = {
        url: attachmentUrl.trim(),
        name,
        type: detectType(attachmentUrl),
      }
      const updatedAttachments = [...attachments, newAttachment]

      await onUpdate(task.id, { attachments: updatedAttachments })
      setAttachments(updatedAttachments)
      setAttachmentUrl('')
      setAttachmentName('')
      setShowAddAttachment(false)
    } catch (err) {
      console.error('Failed to add attachment:', err)
    } finally {
      setSavingAttachment(false)
    }
  }

  async function handleUploadFiles(files: FileList | null) {
    if (!files?.length || !task?.id || !projectId) return

    setUploadingAttachment(true)
    setAttachmentError(null)
    try {
      const uploaded = await Promise.all(Array.from(files).map((file) => uploadTaskFile(file, projectId, orgId)))
      const updatedAttachments = [...attachments, ...uploaded]
      await onUpdate(task.id, { attachments: updatedAttachments })
      setAttachments(updatedAttachments)
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingAttachment(false)
    }
  }

  async function handleRemoveAttachment(index: number) {
    if (!task?.id || !projectId) return

    try {
      const updatedAttachments = attachments.filter((_, i) => i !== index)
      await onUpdate(task.id, { attachments: updatedAttachments })
      setAttachments(updatedAttachments)
    } catch (err) {
      console.error('Failed to remove attachment:', err)
    }
  }

  async function handleToggleChecklistItem(itemId: string) {
    if (!task?.id) return
    const updatedChecklist = checklist.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item,
    )
    setChecklist(updatedChecklist)
    await onUpdate(task.id, { checklist: updatedChecklist })
  }

  async function handleAddChecklistItem() {
    if (!task?.id || !newChecklistItem.trim()) return
    const updatedChecklist = [
      ...checklist,
      { id: `item-${Date.now()}`, text: newChecklistItem.trim(), done: false },
    ]
    setChecklist(updatedChecklist)
    setNewChecklistItem('')
    await onUpdate(task.id, { checklist: updatedChecklist })
  }

  async function handleRemoveChecklistItem(itemId: string) {
    if (!task?.id) return
    const updatedChecklist = checklist.filter((item) => item.id !== itemId)
    setChecklist(updatedChecklist)
    await onUpdate(task.id, { checklist: updatedChecklist })
  }

  function toggleValue(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
  }

  function extractNameFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname
      const filename = pathname.split('/').pop() || 'Attachment'
      return decodeURIComponent(filename)
    } catch {
      return 'Attachment'
    }
  }

  function detectType(url: string): string {
    const ext = url.toLowerCase().split(/[#?]/)[0].split('.').pop() || ''
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
    if (['pdf'].includes(ext)) return 'application/pdf'
    if (['doc', 'docx'].includes(ext)) return 'document'
    if (['xls', 'xlsx'].includes(ext)) return 'spreadsheet'
    return 'file'
  }

  function getAttachmentIcon(type?: string): string {
    if (!type) return 'attach_file'
    if (type.startsWith('image/') || type === 'image') return 'image'
    if (type.startsWith('video/')) return 'movie'
    if (type.includes('pdf')) return 'picture_as_pdf'
    if (type.includes('document')) return 'article'
    if (type.includes('spreadsheet')) return 'table_chart'
    return 'attach_file'
  }

  function isImageAttachment(att: Attachment): boolean {
    const type = (att.mimeType ?? att.type ?? '').toLowerCase()
    const url = att.url.toLowerCase()
    return type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].some(ext => url.endsWith(ext))
  }

  function isVideoAttachment(att: Attachment): boolean {
    const type = (att.mimeType ?? att.type ?? '').toLowerCase()
    const url = att.url.toLowerCase()
    return type.startsWith('video/') || ['mp4', 'mov', 'webm'].some(ext => url.endsWith(ext))
  }

  function getCommentAvatarColor(role: 'admin' | 'client' | 'ai'): string {
    switch (role) {
      case 'admin':
        return 'var(--color-accent-v2)'
      case 'ai':
        return '#3b82f6'
      case 'client':
      default:
        return 'var(--color-on-surface-variant)'
    }
  }

  function formatTimestamp(createdAt: { _seconds: number; _nanoseconds: number }): string {
    try {
      const date = new Date(createdAt._seconds * 1000)
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  function getRoleLabel(role: 'admin' | 'client' | 'ai'): string {
    switch (role) {
      case 'admin':
        return 'Admin'
      case 'ai':
        return 'AI'
      case 'client':
      default:
        return 'Client'
    }
  }

  const priorityColor = PRIORITY_COLORS[task.priority ?? 'medium'] ?? PRIORITY_COLORS.medium

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Panel */}
      <div
        className="relative h-full w-full max-w-md flex flex-col overflow-y-auto"
        style={{ background: 'var(--color-sidebar)', borderLeft: '1px solid var(--color-card-border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          data-task-detail-header
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-[var(--color-card-border)] shrink-0 bg-[var(--color-sidebar)]"
        >
          <div>
            <span
              className="text-[9px] font-label uppercase tracking-widest px-2 py-0.5 rounded"
              style={{ background: `${priorityColor}20`, color: priorityColor }}
            >
              {task.priority ?? 'medium'}
            </span>
            <p className="text-xs text-on-surface-variant mt-1">{columnName}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDelete}
              className="text-xs text-on-surface-variant hover:text-red-400 transition-colors font-label"
            >
              Delete
            </button>
            <button
              type="button"
              aria-label="Close task details"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-2xl leading-none text-on-surface-variant hover:bg-[var(--color-surface-container)] hover:text-on-surface transition-colors"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 px-6 py-5 space-y-5">
          {/* Title */}
          {editing ? (
            <textarea
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full text-lg font-headline font-bold text-on-surface bg-transparent border border-[var(--color-card-border)] rounded-[var(--radius-btn)] p-2 resize-none focus:outline-none focus:border-[var(--color-accent-v2)]"
              rows={2}
              autoFocus
            />
          ) : (
            <h2
              className="text-lg font-headline font-bold text-on-surface cursor-pointer hover:text-on-surface-variant transition-colors"
              onClick={() => setEditing(true)}
            >
              {task.title}
            </h2>
          )}

          {/* Priority selector */}
          <div>
            <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-2">Priority</p>
            <div className="flex gap-2">
              {PRIORITIES.map(p => (
                <button
                  key={p}
                  onClick={() => onUpdate(task.id, { priority: p })}
                  className="text-xs font-label px-2 py-1 rounded capitalize transition-colors"
                  style={
                    task.priority === p
                      ? { background: `${PRIORITY_COLORS[p]}20`, color: PRIORITY_COLORS[p] }
                      : { color: 'var(--color-on-surface-variant)' }
                  }
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-2">Description</p>
            {editing ? (
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full text-sm text-on-surface bg-[var(--color-card)] border border-[var(--color-card-border)] rounded-[var(--radius-btn)] p-3 resize-none focus:outline-none focus:border-[var(--color-accent-v2)] min-h-24"
                rows={4}
                placeholder="Add a description..."
              />
            ) : (
              <p
                className="text-sm text-on-surface-variant cursor-pointer hover:text-on-surface transition-colors min-h-8"
                onClick={() => setEditing(true)}
              >
                {task.description || <span className="italic opacity-50">Add a description...</span>}
              </p>
            )}
          </div>

          {/* Project metadata */}
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Start</span>
              <input
                type="date"
                value={startDate}
                onChange={e => { setStartDate(e.target.value); setEditing(true) }}
                className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-2 py-2 text-xs text-on-surface focus:border-[var(--color-accent-v2)] focus:outline-none"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Due</span>
              <input
                type="date"
                value={dueDate}
                onChange={e => { setDueDate(e.target.value); setEditing(true) }}
                className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-2 py-2 text-xs text-on-surface focus:border-[var(--color-accent-v2)] focus:outline-none"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Estimate</span>
            <input
              type="number"
              min="0"
              step="0.25"
              value={estimateHours}
              onChange={e => { setEstimateHours(e.target.value); setEditing(true) }}
              placeholder="Hours"
              className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-[var(--color-accent-v2)] focus:outline-none"
            />
          </label>

          <div>
            <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-2">Labels</p>
            {editing ? (
              <input
                value={labelsText}
                onChange={e => setLabelsText(e.target.value)}
                placeholder="design, blocked, client"
                className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-[var(--color-accent-v2)] focus:outline-none"
              />
            ) : task.labels && task.labels.length > 0 ? (
              <div className="flex flex-wrap gap-1" onClick={() => setEditing(true)}>
                {task.labels.map(l => (
                  <span key={l} className="text-xs px-2 py-0.5 rounded bg-surface-container text-on-surface-variant">{l}</span>
                ))}
              </div>
            ) : (
              <button onClick={() => setEditing(true)} className="text-xs text-[var(--color-accent-v2)] hover:underline">
                Add labels
              </button>
            )}
          </div>

          <div>
            <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-2">Assignment</p>
            {!hideAgentSection && (
              <div className="mb-2 grid grid-cols-3 gap-1 rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-1">
                {(['people', 'agent', 'orchestration'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setAssignmentMode(mode)
                      setEditing(true)
                      if (mode === 'people') setAssigneeAgentId('')
                      else {
                        setAssigneeIds([])
                        setMentionIds([])
                        if (mode === 'orchestration') setAssigneeAgentId('pip')
                        if (mode === 'agent' && !assigneeAgentId) setAssigneeAgentId(activeAgents(agents)[0]?.agentId ?? '')
                      }
                    }}
                    className={`rounded px-1.5 py-1.5 text-[10px] font-label capitalize transition-colors ${
                      assignmentMode === mode
                        ? 'bg-[var(--color-accent-v2)] text-black'
                        : 'text-on-surface-variant hover:bg-[var(--color-surface-container)] hover:text-on-surface'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            )}
            {assignmentMode === 'people' || hideAgentSection ? (
            <div className="space-y-1 rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-2">
              {members.length === 0 ? (
                <p className="text-xs text-on-surface-variant">No team members found.</p>
              ) : (
                members.map(member => (
                  <label key={member.userId} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--color-surface-container)]">
                    <input
                      type="checkbox"
                      checked={assigneeIds.includes(member.userId)}
                      onChange={() => {
                        setAssigneeIds(current => toggleValue(current, member.userId))
                        setEditing(true)
                      }}
                      className="accent-[var(--color-accent-v2)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-on-surface">{memberLabel(member)}</span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault()
                        setMentionIds(current => toggleValue(current, member.userId))
                        setEditing(true)
                      }}
                      className={`rounded px-1.5 py-0.5 text-[9px] ${
                        mentionIds.includes(member.userId)
                          ? 'bg-[var(--color-accent-v2)] text-black'
                          : 'bg-[var(--color-surface-container)] text-on-surface-variant'
                      }`}
                    >
                      @
                    </button>
                  </label>
                ))
              )}
            </div>
            ) : assignmentMode === 'agent' ? (
            <div className="space-y-1 rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-2">
              {activeAgents(agents).length === 0 ? (
                <p className="text-xs text-on-surface-variant">No agents available.</p>
              ) : (
                activeAgents(agents).map(agent => (
                  <label key={agent.agentId} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--color-surface-container)]">
                    <input
                      type="radio"
                      checked={assigneeAgentId === agent.agentId}
                      onChange={() => {
                        setAssigneeAgentId(agent.agentId)
                        setEditing(true)
                      }}
                      className="accent-[var(--color-accent-v2)]"
                    />
                    <span className="material-symbols-outlined text-[15px] text-on-surface-variant">{agent.iconKey ?? 'smart_toy'}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-on-surface">{agentLabel(agent, agent.agentId)}</span>
                    {agent.lastHealthStatus && (
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        agent.lastHealthStatus === 'ok' ? 'bg-emerald-400' : agent.lastHealthStatus === 'degraded' ? 'bg-amber-400' : 'bg-red-400'
                      }`} />
                    )}
                  </label>
                ))
              )}
            </div>
            ) : (
              <div className="rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-2">
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1">
                  <input
                    type="radio"
                    checked
                    readOnly
                    className="accent-[var(--color-accent-v2)]"
                  />
                  <span className="material-symbols-outlined text-[15px] text-on-surface-variant">hub</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-on-surface">Pip orchestration</span>
                </label>
              </div>
            )}
            {task.agentStatus && (() => {
              const STATUS_STYLE: Record<string, { label: string; className: string }> = {
                'pending':        { label: 'Waiting',   className: 'bg-white/10 text-on-surface-variant' },
                'picked-up':      { label: 'Picked up', className: 'bg-sky-500/20 text-sky-400' },
                'in-progress':    { label: 'Working',   className: 'bg-amber-500/20 text-amber-400' },
                'awaiting-input': { label: 'Needs your input', className: 'bg-orange-500/20 text-orange-400' },
                'done':           { label: 'Done',      className: 'bg-emerald-500/20 text-emerald-400' },
                'blocked':        { label: 'Blocked',   className: 'bg-red-500/20 text-red-400' },
              }
              const style = STATUS_STYLE[task.agentStatus] ?? { label: task.agentStatus, className: 'bg-white/10 text-on-surface-variant' }
              const stale = (task.agentStatus === 'in-progress' || task.agentStatus === 'picked-up') && isAgentStale(task.agentHeartbeatAt, 5)
              const agentName = task.assigneeAgentId ? (task.assigneeAgentId.charAt(0).toUpperCase() + task.assigneeAgentId.slice(1)) : 'Agent'
              return (
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded ${style.className}`}>
                      {style.label}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {stale && (
                        <button
                          type="button"
                          onClick={() => onUpdate(task.id, { assigneeAgentId: task.assigneeAgentId as AgentId })}
                          className="text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors"
                          title="Agent may be stuck — reset to re-queue"
                        >
                          Retry
                        </button>
                      )}
                      {(['blocked', 'awaiting-input'].includes(String(task.agentStatus)) || task.columnId === 'blocked') && (
                        <button
                          type="button"
                          onClick={handleRetryTask}
                          className="text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors"
                          title="Move back to To Do and let it be tried again"
                        >
                          Try again
                        </button>
                      )}
                      {task.columnId === 'review' && task.agentStatus === 'done' && (
                        <button
                          type="button"
                          onClick={handleApproveReview}
                          className="inline-flex items-center gap-1 text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[12px]">check_circle</span>
                          Approve
                        </button>
                      )}
                      {task.agentStatus === 'done' && !showRevisionForm && (
                        <button
                          type="button"
                          onClick={() => setShowRevisionForm(true)}
                          className="inline-flex items-center gap-1 text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[12px]">replay</span>
                          Request Revision
                        </button>
                      )}
                      {orgSlug && task.assigneeAgentId && (
                        <button
                          type="button"
                          onClick={() => {
                            const base = `/admin/org/${orgSlug}/messages`
                            const qs = new URLSearchParams({ agent: task.assigneeAgentId! })
                            if (task.agentConversationId) {
                              qs.set('runId', task.agentConversationId)
                              qs.set('taskId', task.id)
                              qs.set('taskTitle', String(task.title ?? ''))
                            } else { qs.set('taskId', task.id); qs.set('taskTitle', String(task.title ?? '')) }
                            router.push(`${base}?${qs.toString()}`)
                          }}
                          className="inline-flex items-center gap-1 text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded bg-[var(--color-accent-v2)]/10 text-[var(--color-accent-v2)] hover:bg-[var(--color-accent-v2)]/20 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[12px]">forum</span>
                          {task.agentConversationId ? 'View session' : `Chat with ${agentName}`}
                        </button>
                      )}
                    </div>
                  </div>
                  {stale && (
                    <p className="text-[10px] text-orange-400/80 leading-snug">
                      No heartbeat in over 5 minutes — the agent may be stuck. Hit Retry to re-queue it.
                    </p>
                  )}
                  {showRevisionForm && (
                    <div className="rounded border border-red-500/20 bg-red-500/5 p-3 space-y-2">
                      <p className="text-[10px] font-label uppercase tracking-widest text-red-400">What needs to change?</p>
                      <textarea
                        value={revisionNote}
                        onChange={e => setRevisionNote(e.target.value)}
                        placeholder="Describe what's wrong or what to do differently…"
                        rows={3}
                        className="w-full rounded border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant focus:border-red-400 focus:outline-none resize-none"
                        autoFocus
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => { setShowRevisionForm(false); setRevisionNote('') }}
                          className="text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded text-on-surface-variant hover:text-on-surface transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleRequestRevision}
                          disabled={!revisionNote.trim() || submittingRevision}
                          className="inline-flex items-center gap-1 text-[10px] font-label uppercase tracking-wide px-3 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-40 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[12px]">replay</span>
                          {submittingRevision ? 'Sending…' : 'Re-queue with feedback'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
            <div className="mt-3">
              <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-2">Review by</p>
              <div className="space-y-1 rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-2">
                {members.map(member => (
                  <label key={member.userId} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--color-surface-container)]">
                    <input
                      type="checkbox"
                      checked={reviewerIds.includes(member.userId)}
                      onChange={() => { setReviewerIds(current => toggleValue(current, member.userId)); setEditing(true) }}
                      className="accent-[var(--color-accent-v2)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-on-surface">{memberLabel(member)}</span>
                  </label>
                ))}
                {!hideAgentSection && activeAgents(agents).map(agent => (
                  <label key={agent.agentId} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--color-surface-container)]">
                    <input
                      type="radio"
                      name="detailReviewerAgent"
                      checked={reviewerAgentId === agent.agentId}
                      onChange={() => { setReviewerAgentId(agent.agentId); setEditing(true) }}
                      className="accent-[var(--color-accent-v2)]"
                    />
                    <span className="material-symbols-outlined text-[15px] text-on-surface-variant">{agent.iconKey ?? 'rate_review'}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-on-surface">{agentLabel(agent, agent.agentId)}</span>
                  </label>
                ))}
              </div>
            </div>
            {task.reviewStatus && (
              <p className="mt-2 text-[10px] text-on-surface-variant">Review status: {task.reviewStatus}</p>
            )}
            {task.agentOutput?.summary && (
              <div className="mt-2 rounded border border-[var(--color-card-border)] bg-[var(--color-surface-container)] p-2 text-xs text-on-surface-variant">
                <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Agent output</p>
                {task.agentOutput.summary}
              </div>
            )}
            {task.agentConversationId && orgSlug && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
                <button
                  type="button"
                  onClick={() => {
                    const qs = new URLSearchParams({
                      runId: task.agentConversationId!,
                      taskId: task.id,
                      taskTitle: String(task.title ?? ''),
                    })
                    if (task.assigneeAgentId) qs.set('agent', task.assigneeAgentId)
                    router.push(`/admin/org/${orgSlug}/messages?${qs.toString()}`)
                  }}
                  className="text-[10px] text-sky-400 hover:underline"
                >
                  Live session →
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-[var(--color-outline-variant)] pt-4">
            <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-3">
              Checklist {checklist.length > 0 && `(${checklist.filter(item => item.done).length}/${checklist.length})`}
            </p>
            <div className="space-y-2">
              {checklist.map(item => (
                <div key={item.id} className="flex items-start gap-2 rounded border border-[var(--color-card-border)] bg-[var(--color-card)] p-2">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() => handleToggleChecklistItem(item.id)}
                    className="mt-0.5 accent-[var(--color-accent-v2)]"
                  />
                  <span className={`min-w-0 flex-1 text-xs ${item.done ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>
                    {item.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveChecklistItem(item.id)}
                    className="text-on-surface-variant hover:text-red-400"
                    title="Remove item"
                  >
                    <span className="material-symbols-outlined text-[15px]">close</span>
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  value={newChecklistItem}
                  onChange={e => setNewChecklistItem(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddChecklistItem()
                    }
                  }}
                  placeholder="Add checklist item"
                  className="min-w-0 flex-1 rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-xs text-on-surface placeholder:text-on-surface-variant focus:border-[var(--color-accent-v2)] focus:outline-none"
                />
                <button onClick={handleAddChecklistItem} className="pib-btn-secondary px-3 py-2 text-xs" title="Add checklist item">
                  <span className="material-symbols-outlined text-[16px]">add</span>
                </button>
              </div>
            </div>
          </div>

          {/* Attachments section */}
          <div className="border-t border-[var(--color-outline-variant)] mt-4 pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant">
                Attachments {attachments.length > 0 && `(${attachments.length})`}
              </p>
              <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-[var(--color-accent-v2)] hover:underline">
                <span className="material-symbols-outlined text-[15px]">cloud_upload</span>
                {uploadingAttachment ? 'Uploading...' : 'Upload'}
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  className="hidden"
                  disabled={uploadingAttachment}
                  onChange={(event) => {
                    handleUploadFiles(event.target.files)
                    event.currentTarget.value = ''
                  }}
                />
              </label>
            </div>

            {attachmentError && <p className="mb-2 text-xs text-[#ef4444]">{attachmentError}</p>}

            {attachments.length > 0 && (
              <div className="space-y-2 mb-3">
                {attachments.map((att, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-2 rounded border border-[var(--color-card-border)] hover:border-[var(--color-accent-v2)] transition-colors group">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <span className="material-symbols-outlined mt-0.5 flex-shrink-0 text-[18px] text-on-surface-variant">
                        {getAttachmentIcon(att.mimeType ?? att.type)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <a
                          href={att.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[var(--color-accent-v2)] hover:underline truncate block font-medium"
                          title={att.name}
                        >
                          {att.name}
                        </a>
                        <p className="text-[10px] text-on-surface-variant">{formatSize(att.size)}</p>
                        {isImageAttachment(att) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={att.url} alt={att.name} className="max-h-16 mt-1 rounded cursor-pointer hover:opacity-80" onClick={() => window.open(att.url, '_blank')} />
                        )}
                        {isVideoAttachment(att) && (
                          <video src={att.url} className="mt-1 max-h-20 rounded" controls />
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleRemoveAttachment(idx)}
                      className="text-on-surface-variant hover:text-red-400 transition-colors text-sm flex-shrink-0 opacity-0 group-hover:opacity-100"
                      title="Remove attachment"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showAddAttachment ? (
              <div className="space-y-2 p-3 rounded border border-[var(--color-card-border)] bg-[var(--color-card)]">
                <input
                  type="url"
                  placeholder="https://example.com/file.pdf"
                  value={attachmentUrl}
                  onChange={e => setAttachmentUrl(e.target.value)}
                  disabled={savingAttachment}
                  className="w-full bg-transparent border border-[var(--color-outline-variant)] rounded-[var(--radius-btn)] px-3 py-2 text-sm text-[var(--color-on-surface)] placeholder:text-on-surface-variant focus:outline-none focus:border-[var(--color-accent-v2)] disabled:opacity-50"
                />
                <input
                  type="text"
                  placeholder="File name"
                  value={attachmentName}
                  onChange={e => setAttachmentName(e.target.value)}
                  disabled={savingAttachment}
                  className="w-full bg-transparent border border-[var(--color-outline-variant)] rounded-[var(--radius-btn)] px-3 py-2 text-sm text-[var(--color-on-surface)] placeholder:text-on-surface-variant focus:outline-none focus:border-[var(--color-accent-v2)] disabled:opacity-50"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleAddAttachment}
                    disabled={!attachmentUrl.trim() || savingAttachment}
                    className="pib-btn-primary text-xs px-3 py-2 flex-1"
                  >
                    {savingAttachment ? '...' : 'Attach link'}
                  </button>
                  <button
                    onClick={() => { setShowAddAttachment(false); setAttachmentUrl(''); setAttachmentName('') }}
                    disabled={savingAttachment}
                    className="pib-btn-secondary text-xs px-3 py-2 flex-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddAttachment(true)}
                className="inline-flex items-center gap-1 text-xs text-[var(--color-accent-v2)] hover:underline cursor-pointer"
              >
                <span className="material-symbols-outlined text-[15px]">add_link</span>
                Add link
              </button>
            )}
          </div>

          {/* Comments section divider */}
          <div className="border-t border-[var(--color-outline-variant)] mt-4 pt-4">
            <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-3">Comments</p>

            {/* Comments list */}
            {loadingComments ? (
              <p className="text-xs text-on-surface-variant italic">Loading comments...</p>
            ) : comments.length === 0 ? (
              <p className="text-xs text-on-surface-variant italic mb-3">No comments yet</p>
            ) : (
              <div className="space-y-3 max-h-48 overflow-y-auto mb-3">
                {comments.map(comment => (
                  <div key={comment.id} className="text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      {/* Avatar */}
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                        style={{ background: getCommentAvatarColor(comment.userRole) }}
                      >
                        {comment.userName.charAt(0).toUpperCase()}
                      </div>

                      {/* Name and role */}
                      <span className="text-on-surface font-medium">{comment.userName}</span>
                      <span
                        className="text-[9px] font-label uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{
                          background:
                            comment.userRole === 'admin'
                              ? 'var(--color-accent-v2)20'
                              : comment.userRole === 'ai'
                                ? '#3b82f620'
                                : 'var(--color-outline)20',
                          color:
                            comment.userRole === 'admin'
                              ? 'var(--color-accent-v2)'
                              : comment.userRole === 'ai'
                                ? '#3b82f6'
                                : 'var(--color-on-surface-variant)',
                        }}
                      >
                        {getRoleLabel(comment.userRole)}
                      </span>

                      {/* Timestamp */}
                      <span className="text-on-surface-variant ml-auto">{formatTimestamp(comment.createdAt)}</span>
                    </div>

                    {/* Comment text */}
                    <p className="text-on-surface-variant ml-7 leading-snug">{comment.text}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Comment input */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Type a comment..."
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSubmitComment()
                  }
                }}
                disabled={submittingComment}
                className="flex-1 bg-transparent border border-[var(--color-outline-variant)] rounded-[var(--radius-btn)] px-3 py-2 text-sm text-[var(--color-on-surface)] placeholder:text-on-surface-variant focus:outline-none focus:border-[var(--color-accent-v2)] disabled:opacity-50"
              />
              <button
                onClick={handleSubmitComment}
                disabled={!commentText.trim() || submittingComment}
                className="pib-btn-primary text-xs px-3 py-2"
              >
                {submittingComment ? '...' : 'Send'}
              </button>
            </div>
          </div>
        </div>

        {/* Save bar */}
        {editing && (
          <div className="shrink-0 px-6 py-4 border-t border-[var(--color-card-border)] flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="pib-btn-primary text-sm font-label"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
            <button
              onClick={() => { setEditing(false); setTitle(task.title); setDescription(task.description ?? '') }}
              className="pib-btn-secondary text-sm font-label"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
