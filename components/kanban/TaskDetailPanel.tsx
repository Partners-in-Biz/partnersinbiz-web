'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { uploadTaskFile } from './TaskComposer'
import { ContextReferenceChips } from '@/components/context-references/ContextReferenceChips'
import { ContextReferencePicker } from '@/components/context-references/ContextReferencePicker'
import { AGENT_EFFORT_OPTIONS, AGENT_MODEL_OPTIONS, type AgentEffort, type AgentModel } from '@/lib/agents/runRouting'
import { buildBlockedTaskRecovery } from '@/lib/projects/blockerRecovery'
import { ReadableTaskText } from './ReadableTaskText'
import type { ContextReference } from '@/lib/context-references/types'
import type { AgentId, AgentMember, Attachment, ChecklistItem, Task, TeamMember } from './types'

interface Comment {
  id?: string
  text: string
  userId?: string
  userName?: string
  userRole?: 'admin' | 'client' | 'ai' | string
  createdAt?: { _seconds?: number; _nanoseconds?: number } | string | null
  agentPickedUp?: boolean
  agentPickedUpAt?: unknown
  contextRefs?: ContextReference[]
}

interface TaskDetailPanelProps {
  task: Task | null
  columnName: string
  projectId: string
  orgId?: string
  members?: TeamMember[]
  agents?: AgentMember[]
  hideAgentSection?: boolean
  surface?: 'admin' | 'portal'
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

function dateFromUnknown(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date && Number.isFinite(value.getTime())) return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isFinite(parsed.getTime()) ? parsed : null
  }
  if (typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof timestamp.toDate === 'function') {
      const parsed = timestamp.toDate()
      return Number.isFinite(parsed.getTime()) ? parsed : null
    }
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000)
  }
  return null
}

function dateInputValue(value: unknown): string {
  return dateFromUnknown(value)?.toISOString().slice(0, 10) ?? ''
}

function dateTimeInputValue(value: unknown): string {
  const date = dateFromUnknown(value)
  if (!date) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000)
  return local.toISOString().slice(0, 16)
}

function formatTaskDateTime(value: unknown): string {
  const date = dateFromUnknown(value)
  if (!date) return ''
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
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

export function TaskDetailPanel({ task, columnName, projectId, orgId, members = [], agents = [], hideAgentSection = false, surface = 'portal', onClose, onUpdate, onDelete }: TaskDetailPanelProps) {
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
  const [contextRefs, setContextRefs] = useState<ContextReference[]>(task?.contextRefs ?? [])
  const [reviewerIds, setReviewerIds] = useState<string[]>(task?.reviewerIds ?? [])
  const [reviewerAgentId, setReviewerAgentId] = useState<AgentId | ''>((task?.reviewerAgentId as AgentId | null) ?? '')
  const [agentEffort, setAgentEffort] = useState<AgentEffort | ''>((task?.agentEffort as AgentEffort | null) ?? '')
  const [agentModel, setAgentModel] = useState<AgentModel | ''>((task?.agentModel as AgentModel | null) ?? '')
  const [dueDate, setDueDate] = useState(dateInputValue(task?.dueDate))
  const [startDate, setStartDate] = useState(dateInputValue(task?.startDate))
  const [agentReleaseAt, setAgentReleaseAt] = useState(dateTimeInputValue(task?.agentReleaseAt))
  const [estimateHours, setEstimateHours] = useState(task?.estimateMinutes ? String(task.estimateMinutes / 60) : '')
  const [checklist, setChecklist] = useState<ChecklistItem[]>(task?.checklist ?? [])
  const [saving, setSaving] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentText, setCommentText] = useState('')
  const [commentContextRefs, setCommentContextRefs] = useState<ContextReference[]>([])
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
  const [unblocking, setUnblocking] = useState(false)
  const [unblockError, setUnblockError] = useState<string | null>(null)
  const [approvalGateBusy, setApprovalGateBusy] = useState<'approve' | 'reject' | null>(null)
  const [approvalGateError, setApprovalGateError] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const isAdminSurface = surface === 'admin'

  useEffect(() => {
    setEditing(false)
    setTitle(task?.title ?? '')
    setDescription(task?.description ?? '')
    setLabelsText(task?.labels?.join(', ') ?? '')
    setAssigneeIds(task?.assigneeIds ?? (task?.assigneeId ? [task.assigneeId] : []))
    setAssigneeAgentId((task?.assigneeAgentId as AgentId | null) ?? '')
    setAssignmentMode(assignmentModeForTask(task))
    setMentionIds(task?.mentionIds ?? [])
    setContextRefs(task?.contextRefs ?? [])
    setCommentContextRefs([])
    setReviewerIds(task?.reviewerIds ?? [])
    setReviewerAgentId((task?.reviewerAgentId as AgentId | null) ?? '')
    setAgentEffort((task?.agentEffort as AgentEffort | null) ?? '')
    setAgentModel((task?.agentModel as AgentModel | null) ?? '')
    setDueDate(dateInputValue(task?.dueDate))
    setStartDate(dateInputValue(task?.startDate))
    setAgentReleaseAt(dateTimeInputValue(task?.agentReleaseAt))
    setEstimateHours(task?.estimateMinutes ? String(task.estimateMinutes / 60) : '')
    setChecklist(task?.checklist ?? [])
    setAttachments(task?.attachments ?? [])
    setAttachmentError(null)
    setUnblockError(null)
    setApprovalGateError(null)
    setShowDeleteConfirm(false)
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
    const releaseDate = agentReleaseAt ? new Date(agentReleaseAt) : null
    const hasReleaseDate = releaseDate !== null && Number.isFinite(releaseDate.getTime())
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
              ...(task.agentInput?.context ?? {}),
              projectId,
              orgId: orgId ?? null,
              columnId: task.columnId,
              assignmentMode: effectiveMode,
              ...(contextRefs.length > 0 ? { contextRefs } : {}),
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
      contextRefs,
      reviewerIds,
      reviewerAgentId: reviewerAgentId || null,
      agentEffort: agentId && agentEffort ? agentEffort : null,
      agentModel: agentId && agentModel ? agentModel : null,
      dueDate: dueDate || null,
      startDate: startDate || null,
      agentReleaseAt: hasReleaseDate ? releaseDate!.toISOString() : null,
      agentReleaseStatus: hasReleaseDate ? 'scheduled' : null,
      estimateMinutes: Number.isFinite(estimate) && estimate > 0 ? Math.round(estimate * 60) : null,
    })
    setSaving(false)
    setEditing(false)
  }

  async function handleDelete() {
    if (!task) return
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

  async function handleUnblockTask() {
    if (!task?.id || !projectId) return
    setUnblocking(true)
    setUnblockError(null)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/tasks/${task.id}/unblock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const body = await res.json().catch(() => ({})) as { success?: boolean; error?: string; reasons?: string[]; data?: { reasons?: string[] } }
      if (!res.ok || !body.success) {
        const reasonList = Array.isArray(body.data?.reasons) && body.data.reasons.length > 0 ? body.data.reasons : body.reasons
        const reasons = Array.isArray(reasonList) && reasonList.length > 0 ? reasonList : [body.error ?? 'Cannot unblock this task yet.']
        setUnblockError(reasons.join(' '))
        return
      }
      await onUpdate(task.id, {
        columnId: 'todo',
        agentStatus: task.assigneeAgentId ? 'pending' : null,
        reviewStatus: task.assigneeAgentId ? 'changes-requested' : null,
        labels: task.labels?.filter((label) => !/^blocked$/i.test(label) && !/^awaiting-input$/i.test(label)),
      })
    } catch (err) {
      setUnblockError(err instanceof Error ? err.message : 'Cannot unblock this task yet.')
    } finally {
      setUnblocking(false)
    }
  }

  async function handleApproveReview() {
    if (!task?.id) return
    const hasOpenBusinessGate = task.approvalStatus === 'pending' && task.approvalGate && task.approvalGate !== 'none'
    await onUpdate(task.id, {
      columnId: hasOpenBusinessGate ? 'review' : 'done',
      reviewStatus: 'approved',
    })
  }

  async function postSystemComment(text: string) {
    if (!task?.id || !projectId) return null
    const res = await fetch(`/api/v1/projects/${projectId}/tasks/${task.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok === false || !body.success) {
      throw new Error(typeof body.error === 'string' ? body.error : 'Could not save approval comment')
    }
    if (body.data) setComments(prev => [...prev, body.data])
    return body.data ?? null
  }

  async function handleApprovalGateDecision(decision: 'approve' | 'reject') {
    if (!task?.id) return
    setApprovalGateBusy(decision)
    setApprovalGateError(null)
    try {
      if (decision === 'approve') {
        await postSystemComment('✅ Peet approved this implementation plan for development. This approval does not approve production deployment, client-visible publishing, spend, secrets/config changes, destructive actions, finance changes, or live data backfill.')
        await onUpdate(task.id, {
          columnId: 'done',
          reviewStatus: 'approved',
          approvalStatus: 'approved',
        })
      } else {
        await postSystemComment('❌ Peet rejected this approval gate. Changes are required before development can start.')
        await onUpdate(task.id, {
          columnId: 'todo',
          reviewStatus: 'changes-requested',
          approvalStatus: 'rejected',
        })
      }
    } catch (err) {
      setApprovalGateError(err instanceof Error ? err.message : 'Could not record approval decision')
    } finally {
      setApprovalGateBusy(null)
    }
  }

  async function handleSubmitComment() {
    if (!commentText.trim() || !task?.id || !projectId) return

    setSubmittingComment(true)
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: commentText.trim(),
          ...(commentContextRefs.length > 0 ? { contextRefs: commentContextRefs } : {}),
        }),
      })
      const body = await res.json()
      if (body.success && body.data) {
        setComments(prev => [...prev, body.data])
        setCommentText('')
        setCommentContextRefs([])
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

  function getCommentAvatarColor(role?: string): string {
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

  function formatTimestamp(createdAt?: { _seconds?: number; _nanoseconds?: number } | string | null): string {
    try {
      const date = typeof createdAt === 'string'
        ? new Date(createdAt)
        : typeof createdAt?._seconds === 'number'
          ? new Date(createdAt._seconds * 1000)
          : null
      if (!date || !Number.isFinite(date.getTime())) return ''
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  function getRoleLabel(role?: string): string {
    switch (role) {
      case 'admin':
        return 'Admin'
      case 'ai':
        return 'AI'
      case 'client':
        return 'Client'
      case 'system':
        return 'System'
      default:
        return 'Comment'
    }
  }

  function getCommentAuthor(comment: Comment): string {
    return comment.userName?.trim() || comment.userId?.trim() || getRoleLabel(comment.userRole)
  }

  function getCommentInitial(comment: Comment): string {
    return getCommentAuthor(comment).charAt(0).toUpperCase() || '?'
  }

  const priorityColor = PRIORITY_COLORS[task.priority ?? 'medium'] ?? PRIORITY_COLORS.medium
  const blockerRecovery = buildBlockedTaskRecovery(task, comments)
  const isApprovalGate = task.labels?.some((label) => label.toLowerCase() === 'approval-gate') || task.approvalStatus === 'pending'
  const approvalGateResolved = task.approvalStatus === 'approved' || task.approvalStatus === 'rejected' || task.approvalStatus === 'denied'
  const reviewerAgent = task.reviewerAgentId ? agents.find((agent) => agent.agentId === task.reviewerAgentId) : undefined
  const reviewStatusLabel = task.reviewStatus === 'approved'
    ? 'Passed'
    : task.reviewStatus === 'changes-requested'
      ? 'Failed / changes requested'
      : task.reviewStatus === 'in-progress'
        ? 'In progress'
        : task.reviewStatus === 'pending'
          ? 'Pending reviewer'
          : 'Not started'
  const approvalStatusLabel = task.approvalStatus === 'approved'
    ? 'Approved'
    : task.approvalStatus === 'rejected' || task.approvalStatus === 'denied'
      ? 'Rejected'
      : task.approvalStatus === 'pending'
        ? 'Pending'
        : task.approvalGate && task.approvalGate !== 'none'
          ? 'Gate identified'
          : 'No business approval gate'
  const hasReviewPackage = Boolean(
    task.reviewerAgentId
    || task.reviewStatus
    || task.approvalStatus
    || task.requiredCapability
    || task.riskLevel
    || (task.approvalGate && task.approvalGate !== 'none')
    || task.expectedArtifacts?.length
    || task.verifierChecklist?.length,
  )

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
          <div className="min-w-0 space-y-2">
            <button
              type="button"
              aria-label="Back to board"
              onClick={onClose}
              className="inline-flex sm:hidden items-center gap-1 rounded-full border border-[var(--color-card-border)] px-3 py-2 text-xs font-label uppercase tracking-wide text-on-surface hover:bg-[var(--color-surface-container)] transition-colors"
            >
              <span aria-hidden="true">←</span>
              Back to board
            </button>
            <div>
              <span
                className="text-[9px] font-label uppercase tracking-widest px-2 py-0.5 rounded"
                style={{ background: `${priorityColor}20`, color: priorityColor }}
              >
                {task.priority ?? 'medium'}
              </span>
              <p className="text-xs text-on-surface-variant mt-1">{columnName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={`Delete project task ${task.title}`}
              onClick={() => setShowDeleteConfirm(true)}
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

        {showDeleteConfirm && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-4">
            <div
              role="alertdialog"
              aria-modal="true"
              aria-label={`Delete project task "${task.title}"?`}
              className="rounded-[var(--radius-card)] border border-red-500/30 bg-[var(--color-sidebar)] p-4 shadow-sm"
            >
              <p className="text-sm font-label text-on-surface">Delete project task &quot;{task.title}&quot;?</p>
              <p className="mt-2 text-xs leading-5 text-on-surface-variant">
                This removes the task from the board for everyone. Comments, blockers, and assignments on this task will no longer be visible from the project workspace.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded-[var(--radius-btn)] bg-red-500 px-3 py-2 text-xs font-label text-white transition-colors hover:bg-red-400"
                >
                  Confirm delete project task {task.title}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="pib-btn-secondary text-xs font-label"
                >
                  Keep task
                </button>
              </div>
            </div>
          </div>
        )}

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
            <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-2">{isAdminSurface ? 'Operator brief' : 'Description'}</p>
            {editing ? (
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full text-sm text-on-surface bg-[var(--color-card)] border border-[var(--color-card-border)] rounded-[var(--radius-btn)] p-3 resize-none focus:outline-none focus:border-[var(--color-accent-v2)] min-h-24"
                rows={4}
                placeholder={isAdminSurface ? 'Add an internal admin note...' : 'Add a description...'}
              />
            ) : (
              <div
                className="text-sm text-on-surface-variant cursor-pointer hover:text-on-surface transition-colors min-h-8"
                onClick={() => setEditing(true)}
              >
                <ReadableTaskText text={task.description} empty={<span className="italic opacity-50">{isAdminSurface ? 'Add an internal admin note...' : 'Add a description...'}</span>} />
              </div>
            )}
          </div>

          {isApprovalGate && (
            <div className="rounded-[var(--radius-card)] border border-[var(--color-accent-v2)]/40 bg-[var(--color-accent-v2)]/10 p-4">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[20px] text-[var(--color-accent-v2)]">approval</span>
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <p className="text-sm font-label text-on-surface">Approval gate</p>
                    <p className="mt-1 text-xs leading-5 text-on-surface-variant">
                      This card is waiting for Peet to approve or reject the scoped internal work. Approval releases the dependent agent tasks; it does not approve production, public/client-visible actions, spend, secrets/config changes, destructive actions, finance changes, or live backfills.
                    </p>
                  </div>
                  {approvalGateError ? <p className="text-xs text-[#ef4444]">{approvalGateError}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleApprovalGateDecision('approve')}
                      disabled={approvalGateResolved || !!approvalGateBusy}
                      className="pib-btn-primary text-xs font-label"
                    >
                      {approvalGateBusy === 'approve' ? 'Approving...' : approvalGateResolved ? 'Approved' : 'Approve this gate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApprovalGateDecision('reject')}
                      disabled={approvalGateResolved || !!approvalGateBusy}
                      className="pib-btn-secondary text-xs font-label"
                    >
                      {approvalGateBusy === 'reject' ? 'Rejecting...' : 'Reject / request changes'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {hasReviewPackage && (
            <div className="rounded-[var(--radius-card)] border border-purple-400/25 bg-purple-500/5 p-4">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[20px] text-purple-300">fact_check</span>
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <p className="text-sm font-label text-on-surface">Review package</p>
                    <p className="mt-1 text-xs leading-5 text-on-surface-variant">
                      Quality review records objective verification. Business approval records authority for gated actions; one does not imply the other.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded border border-[var(--color-card-border)] bg-[var(--color-card)] p-3">
                      <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Quality review</p>
                      <p className="mt-1 text-sm text-on-surface">{reviewStatusLabel}</p>
                      {(reviewerAgent || task.reviewerAgentId) && (
                        <p className="mt-1 text-xs text-on-surface-variant">Reviewer: {agentLabel(reviewerAgent, task.reviewerAgentId)}</p>
                      )}
                    </div>
                    <div className="rounded border border-[var(--color-card-border)] bg-[var(--color-card)] p-3">
                      <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Business approval</p>
                      <p className="mt-1 text-sm text-on-surface">{approvalStatusLabel}</p>
                      {task.approvalGate && task.approvalGate !== 'none' && (
                        <p className="mt-1 text-xs text-on-surface-variant">Gate: {task.approvalGate}</p>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {task.requiredCapability && (
                      <p className="rounded border border-[var(--color-card-border)] bg-[var(--color-card)] p-2 text-xs text-on-surface-variant">
                        <span className="font-label uppercase tracking-wide text-on-surface">Capability:</span> {task.requiredCapability}
                      </p>
                    )}
                    {task.riskLevel && (
                      <p className="rounded border border-[var(--color-card-border)] bg-[var(--color-card)] p-2 text-xs text-on-surface-variant">
                        <span className="font-label uppercase tracking-wide text-on-surface">Risk:</span> {task.riskLevel}
                      </p>
                    )}
                  </div>
                  {task.expectedArtifacts?.length ? (
                    <div>
                      <p className="mb-1 text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Expected artifacts</p>
                      <ul className="list-disc space-y-1 pl-4 text-xs text-on-surface-variant">
                        {task.expectedArtifacts.map((artifact) => <li key={artifact}>{artifact}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {task.verifierChecklist?.length ? (
                    <div>
                      <p className="mb-1 text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Verifier checklist</p>
                      <ul className="list-disc space-y-1 pl-4 text-xs text-on-surface-variant">
                        {task.verifierChecklist.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

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
            <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-2">{isAdminSurface ? 'Admin context' : 'Context'}</p>
            <ContextReferencePicker
              orgId={orgId}
              projectId={projectId}
              value={contextRefs}
              onChange={(refs) => {
                setContextRefs(refs)
                setEditing(true)
              }}
              inputLabel={isAdminSurface ? 'Add admin task context reference' : 'Add task context reference'}
              compact
            />
          </div>

          <div>
            <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-2">{isAdminSurface ? 'Operator assignment' : 'Assignment'}</p>
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
            {!hideAgentSection && assigneeAgentId && (
              <div className="mt-3 rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-3 space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="block text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Effort</span>
                    <select
                      value={agentEffort}
                      onChange={e => { setAgentEffort(e.target.value as AgentEffort | ''); setEditing(true) }}
                      className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-2 py-2 text-xs text-on-surface focus:border-[var(--color-accent-v2)] focus:outline-none"
                    >
                      <option value="">Auto</option>
                      {AGENT_EFFORT_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Model</span>
                    <select
                      value={agentModel}
                      onChange={e => { setAgentModel(e.target.value as AgentModel | ''); setEditing(true) }}
                      className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-2 py-2 text-xs text-on-surface focus:border-[var(--color-accent-v2)] focus:outline-none"
                    >
                      <option value="">Auto</option>
                      {AGENT_MODEL_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant">Scheduled release</p>
                  {task.agentReleaseStatus === 'scheduled' && Boolean(task.agentReleaseAt) && (
                    <span className="rounded bg-purple-500/15 px-2 py-0.5 text-[9px] font-label uppercase tracking-wide text-purple-300">
                      Backlogged
                    </span>
                  )}
                </div>
                <input
                  type="datetime-local"
                  value={agentReleaseAt}
                  onChange={e => { setAgentReleaseAt(e.target.value); setEditing(true) }}
                  className="w-full rounded-[var(--radius-btn)] border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-xs text-on-surface focus:border-[var(--color-accent-v2)] focus:outline-none"
                />
                <p className="text-[10px] leading-snug text-on-surface-variant">
                  Set a future date/time to keep this agent task out of watcher pickup until release. Dependencies and approval gates still apply when it is released.
                </p>
                {task.agentReleaseStatus === 'scheduled' && Boolean(task.agentReleaseAt) && (
                  <p className="text-[10px] leading-snug text-purple-300/90">
                    Visible on board as scheduled for {formatTaskDateTime(task.agentReleaseAt)}.
                  </p>
                )}
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
              const style = blockerRecovery.needsPeet
                ? { label: 'Needs Peet', className: 'bg-orange-500/20 text-orange-300' }
                : STATUS_STYLE[task.agentStatus] ?? { label: task.agentStatus, className: 'bg-white/10 text-on-surface-variant' }
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
                          Mark review passed
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
                  {blockerRecovery.isBlocked && (
                    <div className="rounded border border-orange-500/25 bg-orange-500/5 p-3 text-xs text-on-surface-variant space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-label uppercase tracking-widest text-orange-300">{blockerRecovery.needsPeet ? 'Needs Peet' : 'Unblock guidance'}</p>
                          <p className="mt-1 text-[11px] leading-4 text-orange-100/80">Exact blocker: {blockerRecovery.blockingReason}</p>
                        </div>
                        {blockerRecovery.canShowUnblockAction && (
                          <button
                            type="button"
                            onClick={handleUnblockTask}
                            disabled={unblocking}
                            aria-label={`Unblock: ${blockerRecovery.continueActionLabel}`}
                            className="inline-flex items-center gap-1 text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 disabled:opacity-40 transition-colors"
                            title="Clear the blocked state only once the listed approval/input and proof are satisfied"
                          >
                            <span className="material-symbols-outlined text-[12px]">lock_open</span>
                            {unblocking ? 'Unblocking…' : blockerRecovery.continueActionLabel}
                          </button>
                        )}
                      </div>
                      <p className="rounded border border-orange-500/15 bg-black/10 p-2 text-[11px] leading-4 text-orange-100/80">
                        Safe continue path: do not bypass approval gates. Production deploys, client-visible sends/publishing, paid spend, finance, secrets/config, and destructive actions still require explicit approval evidence.
                      </p>
                      <p><span className="text-on-surface">What is wrong:</span> {blockerRecovery.whatIsWrong}</p>
                      <p><span className="text-on-surface">Who/what can unblock:</span> {blockerRecovery.whoCanUnblock}</p>
                      <p><span className="text-on-surface">Proof needed:</span> {blockerRecovery.requiredEvidence}</p>
                      <p><span className="text-on-surface">Message for agent:</span> {blockerRecovery.messageForAgent}</p>
                      {unblockError && (
                        <p className="rounded border border-red-500/20 bg-red-500/10 p-2 text-red-300">{unblockError}</p>
                      )}
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
            <p className="text-[9px] font-label uppercase tracking-widest text-on-surface-variant mb-3">{isAdminSurface ? 'Operator comments' : 'Comments'}</p>

            {/* Comments list */}
            {loadingComments ? (
              <p className="text-xs text-on-surface-variant italic">Loading comments...</p>
            ) : comments.length === 0 ? (
              <p className="text-xs text-on-surface-variant italic mb-3">No comments yet</p>
            ) : (
              <div className="space-y-3 max-h-48 overflow-y-auto mb-3">
                {comments.map((comment, index) => (
                  <div key={comment.id ?? `${comment.createdAt ?? 'comment'}-${index}`} className="text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      {/* Avatar */}
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                        style={{ background: getCommentAvatarColor(comment.userRole) }}
                      >
                        {getCommentInitial(comment)}
                      </div>

                      {/* Name and role */}
                      <span className="text-on-surface font-medium">{getCommentAuthor(comment)}</span>
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
                    <div className="text-on-surface-variant ml-7 leading-snug">
                      <ReadableTaskText text={comment.text} compact />
                    </div>
                    <div className="ml-7 mt-1">
                      <ContextReferenceChips refs={comment.contextRefs ?? []} compact />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Comment input */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={isAdminSurface ? 'Internal admin note...' : 'Type a comment...'}
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
              {orgId ? (
                <ContextReferencePicker
                  orgId={orgId}
                  projectId={projectId}
                  value={commentContextRefs}
                  onChange={setCommentContextRefs}
                  inputLabel={isAdminSurface ? 'Add admin comment context reference' : 'Add task comment context reference'}
                  placeholder="@contacts: @projects: @tasks:"
                  disabled={submittingComment}
                  compact
                />
              ) : null}
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
