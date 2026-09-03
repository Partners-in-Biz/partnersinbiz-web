'use client'

import { Icon } from '@/components/studio'

import { useMemo, useRef, useState } from 'react'
import VoiceInputButton from '@/components/chat/VoiceInputButton'
import { ContextReferencePicker } from '@/components/context-references/ContextReferencePicker'
import { AGENT_EFFORT_OPTIONS, AGENT_MODEL_OPTIONS, type AgentEffort, type AgentModel } from '@/lib/agents/runRouting'
import {
  type TaskLlmCredentialSource,
} from '@/lib/projects/task-llm'
import type { ContextReference } from '@/lib/context-references/types'
import type { AgentId, AgentMember, Attachment, ChecklistItem, Column, Task, TeamMember } from './types'

interface TaskComposerProps {
  open: boolean
  column: Column | null
  projectId: string
  orgId?: string
  members: TeamMember[]
  agents?: AgentMember[]
  existingTasks?: Task[]
  hideAgentSection?: boolean
  surface?: 'admin' | 'portal'
  onClose: () => void
  onCreated: (task: Task) => void
}

const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const
const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const
const APPROVAL_GATES = ['none', 'human-review', 'client-visible', 'public-publishing', 'paid-spend', 'production-deploy', 'finance', 'destructive', 'secret-config'] as const
type AssignmentMode = 'people' | 'agent' | 'orchestration'

function cleanList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function cleanLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function fileKind(file: File): 'image' | 'video' | 'file' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'file'
}

function formatSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function newChecklist(text: string): ChecklistItem[] {
  return text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => ({ id: `item-${Date.now()}-${index}`, text: item, done: false }))
}

function memberLabel(member: TeamMember): string {
  return member.displayName || member.email || member.userId
}

function agentLabel(agent?: AgentMember): string {
  return agent?.name || agent?.agentId || 'Agent'
}

function activeAgents(agents: AgentMember[]): AgentMember[] {
  return agents.filter((agent) => agent.enabled !== false)
}

function buildAgentSpec(title: string, description: string, checklist: ChecklistItem[]): string {
  return [
    title.trim(),
    description.trim(),
    checklist.length ? `Checklist:\n${checklist.map((item) => `- ${item.text}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

export async function uploadTaskFile(file: File, projectId: string, orgId?: string): Promise<Attachment> {
  const form = new FormData()
  form.append('folder', `projects/${projectId}/tasks`)
  form.append('relatedToType', 'project')
  form.append('relatedToId', projectId)
  if (orgId) form.append('orgId', orgId)
  form.append('file', file)

  const res = await fetch('/api/v1/upload', { method: 'POST', body: form })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.data?.url) {
    throw new Error(body.error || 'Upload failed')
  }

  return {
    uploadId: body.data.id,
    url: body.data.url,
    name: body.data.name ?? file.name,
    size: body.data.size ?? file.size,
    type: body.data.mimeType ?? file.type,
    mimeType: body.data.mimeType ?? file.type,
  }
}

export function TaskComposer({ open, column, projectId, orgId, members, agents = [], existingTasks = [], hideAgentSection = false, surface = 'portal', onClose, onCreated }: TaskComposerProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('medium')
  const [labels, setLabels] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [startDate, setStartDate] = useState('')
  const [estimateHours, setEstimateHours] = useState('')
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [assigneeAgentId, setAssigneeAgentId] = useState<AgentId | ''>('')
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>('people')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [contextRefs, setContextRefs] = useState<ContextReference[]>([])
  const [dependsOn, setDependsOn] = useState<string[]>([])
  const [reviewerIds, setReviewerIds] = useState<string[]>([])
  const [reviewerAgentId, setReviewerAgentId] = useState<AgentId | ''>('')
  const [agentEffort, setAgentEffort] = useState<AgentEffort | ''>('')
  const [agentModel, setAgentModel] = useState<AgentModel | ''>('')
  const [llmCredentialSource, setLlmCredentialSource] = useState<TaskLlmCredentialSource | ''>('')
  const [requiredCapability, setRequiredCapability] = useState('')
  const [riskLevel, setRiskLevel] = useState<(typeof RISK_LEVELS)[number] | ''>('')
  const [approvalGate, setApprovalGate] = useState<(typeof APPROVAL_GATES)[number] | ''>('')
  const [expectedArtifactsText, setExpectedArtifactsText] = useState('')
  const [verifierChecklistText, setVerifierChecklistText] = useState('')
  const [checklistText, setChecklistText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mouseDownOnBackdrop = useRef(false)

  const canSave = title.trim().length > 0 && !saving
  const isAdminSurface = surface === 'admin'
  const dialogTitle = isAdminSurface ? 'New operator task' : 'New project task'
  const selectedMembers = useMemo(
    () => members.filter((member) => assigneeIds.includes(member.userId)),
    [assigneeIds, members],
  )

  if (!open || !column) return null

  function toggleValue(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
  }

  function addFiles(nextFiles: FileList | File[]) {
    const incoming = Array.from(nextFiles)
    setFiles((current) => [...current, ...incoming])
  }

  function addVoiceTranscriptToDescription(text: string) {
    const cleanText = text.trim()
    if (!cleanText) return
    setDescription((current) => {
      const trimmed = current.trimEnd()
      return trimmed ? `${trimmed}\n\n${cleanText}` : cleanText
    })
  }

  function reset() {
    setTitle('')
    setDescription('')
    setPriority('medium')
    setLabels('')
    setDueDate('')
    setStartDate('')
    setEstimateHours('')
    setAssigneeIds([])
    setAssigneeAgentId('')
    setAssignmentMode('people')
    setMentionIds([])
    setContextRefs([])
    setDependsOn([])
    setReviewerIds([])
    setReviewerAgentId('')
    setAgentEffort('')
    setAgentModel('')
    setRequiredCapability('')
    setRiskLevel('')
    setApprovalGate('')
    setExpectedArtifactsText('')
    setVerifierChecklistText('')
    setChecklistText('')
    setFiles([])
    setError(null)
  }

  async function handleSubmit() {
    if (!canSave) return
    if (!column) return

    try {
      setSaving(true)
      setError(null)

      const attachments = await Promise.all(files.map((file) => uploadTaskFile(file, projectId, orgId)))
      const estimate = Number.parseFloat(estimateHours)
      const checklist = newChecklist(checklistText)
      const expectedArtifacts = cleanLines(expectedArtifactsText)
      const verifierChecklist = cleanLines(verifierChecklistText)
      const order = Date.now()
      const effectiveMode = hideAgentSection ? 'people' : assignmentMode
      const agentId = effectiveMode === 'orchestration' ? 'pip' : effectiveMode === 'agent' ? assigneeAgentId : ''
      const peopleIds = effectiveMode === 'people' ? assigneeIds : []
      const selectedMentionIds = effectiveMode === 'people' ? mentionIds : []
      const spec = buildAgentSpec(title, description, checklist)
      const taskPayload = {
        title: title.trim(),
        description: description.trim(),
        columnId: column.id,
        priority,
        order,
        labels: cleanList(labels),
        assigneeId: peopleIds[0] ?? null,
        assigneeIds: peopleIds,
        assigneeAgentId: agentId || null,
        agentInput: agentId
          ? {
              spec,
              context: {
                projectId,
                orgId: orgId ?? null,
                columnId: column.id,
                assignmentMode: effectiveMode,
                ...(contextRefs.length > 0 ? { contextRefs } : {}),
                ...(requiredCapability.trim() ? { requiredCapability: requiredCapability.trim() } : {}),
                ...(riskLevel ? { riskLevel } : {}),
                ...(approvalGate ? { approvalGate } : {}),
                ...(expectedArtifacts.length > 0 ? { expectedArtifacts } : {}),
                ...(verifierChecklist.length > 0 ? { verifierChecklist } : {}),
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
        dependsOn,
        reviewerIds,
        reviewerAgentId: reviewerAgentId || null,
        requiredCapability: requiredCapability.trim() || null,
        riskLevel: riskLevel || null,
        approvalGate: approvalGate || null,
        expectedArtifacts,
        verifierChecklist,
        agentEffort: agentId && agentEffort ? agentEffort : null,
        agentModel: agentId && agentModel ? agentModel : null,
        llmCredentialSource: agentId
          ? (llmCredentialSource || 'auto')
          : null,
        dueDate: dueDate || null,
        startDate: startDate || null,
        estimateMinutes: Number.isFinite(estimate) && estimate > 0 ? Math.round(estimate * 60) : null,
        checklist,
        attachments,
        orgId: orgId ?? '',
      }

      const res = await fetch(`/api/v1/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskPayload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.data?.id) throw new Error(body.error || 'Failed to create task')

      onCreated({ id: body.data.id, ...taskPayload })
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Task creation failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden px-2 py-2 sm:items-center sm:px-4 sm:py-6"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget }}
      onClick={() => { if (mouseDownOnBackdrop.current) onClose() }}
    >
      <div className="absolute inset-0 bg-black/70" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-composer-title"
        className="relative flex max-h-[calc(100dvh-1rem)] w-full min-w-0 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-sidebar)] sm:max-h-[92dvh] md:max-w-4xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-[var(--color-pib-line)] px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <p className="pib-label">
              {column.name}
            </p>
            <h2 id="task-composer-title" className="truncate text-lg font-headline font-medium text-[var(--color-pib-text)]">{dialogTitle}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]"
            title="Close"
          >
            <Icon name="close" />
          </button>
        </header>

        <div data-testid="task-composer-body" className="grid min-h-0 min-w-0 flex-1 gap-0 overflow-x-hidden overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4 p-4 sm:p-5">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={isAdminSurface ? 'Operator task title' : 'Task title'}
              aria-label={isAdminSurface ? 'Operator task title' : 'Task title'}
              className="w-full min-w-0 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] px-4 py-3 text-lg font-headline font-medium text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:border-[var(--color-accent-v2)] focus:outline-none"
              autoFocus
            />
            <div className="space-y-2">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <p className="pib-label">{isAdminSurface ? 'Operator brief' : 'Description'}</p>
                <VoiceInputButton
                  disabled={saving}
                  onTranscript={addVoiceTranscriptToDescription}
                  className="border border-[var(--color-pib-line)] bg-[var(--color-card)]"
                />
              </div>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={isAdminSurface ? 'Internal admin note, goals, acceptance criteria, blockers...' : 'Description, goals, acceptance criteria, blockers...'}
                aria-label={isAdminSurface ? 'Operator brief' : 'Description'}
                rows={7}
                className="w-full min-w-0 resize-y rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] px-4 py-3 text-sm leading-relaxed text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:border-[var(--color-accent-v2)] focus:outline-none"
              />
            </div>

            <div>
              <p className="mb-2 pib-label">Checklist</p>
              <textarea
                value={checklistText}
                onChange={(event) => setChecklistText(event.target.value)}
                placeholder="One item per line"
                aria-label="Checklist"
                rows={4}
                className="w-full min-w-0 resize-y rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] px-4 py-3 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:border-[var(--color-accent-v2)] focus:outline-none"
              />
            </div>

            <div>
              <p className="mb-2 pib-label">Attachments</p>
              <label
                onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  addFiles(event.dataTransfer.files)
                }}
                className="flex min-h-32 min-w-0 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors"
                style={{
                  borderColor: dragging ? 'var(--color-accent-v2)' : 'var(--color-pib-line)',
                  background: dragging ? 'color-mix(in oklab, var(--color-accent-v2) 8%, transparent)' : 'var(--color-card)',
                }}
              >
                <Icon name="cloud_upload" />
                <span className="mt-2 max-w-full break-words text-sm text-[var(--color-pib-text)]">Upload images, videos, documents</span>
                <span className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Firebase Storage</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  className="sr-only"
                  data-impeccable-disable="content-invisible-at-rest"
                  aria-label="Upload attachments"
                  onChange={(event) => {
                    if (event.target.files) addFiles(event.target.files)
                    event.currentTarget.value = ''
                  }}
                />
              </label>
              {files.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {files.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] p-2">
                      <Icon name={fileKind(file) === 'image' ? 'image' : fileKind(file) === 'video' ? 'movie' : 'attach_file'} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[var(--color-pib-text)]">{file.name}</p>
                        <p className="text-[10px] text-[var(--color-pib-text-muted)]">{formatSize(file.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                        className="grid h-7 w-7 place-items-center rounded text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]"
                        title="Remove file"
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="min-w-0 space-y-5 border-t border-[var(--color-pib-line)] p-4 sm:p-5 lg:border-l lg:border-t-0">
            <div>
              <p className="mb-2 pib-label">Priority</p>
              <div className="grid min-w-0 grid-cols-2 gap-2">
                {PRIORITIES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setPriority(item)}
                    className={`min-w-0 rounded-md border px-3 py-2 text-xs font-label capitalize transition-colors ${
                      priority === item
                        ? 'border-[var(--color-accent-v2)] bg-[var(--color-accent-v2)] text-black'
                        : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="min-w-0 space-y-1">
                <span className="pib-label">Start</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="w-full min-w-0 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] focus:border-[var(--color-accent-v2)] focus:outline-none"
                />
              </label>
              <label className="min-w-0 space-y-1">
                <span className="pib-label">Due</span>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="w-full min-w-0 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] focus:border-[var(--color-accent-v2)] focus:outline-none"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="pib-label">Estimate</span>
              <input
                type="number"
                min="0"
                step="0.25"
                value={estimateHours}
                onChange={(event) => setEstimateHours(event.target.value)}
                placeholder="Hours"
                className="w-full min-w-0 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:border-[var(--color-accent-v2)] focus:outline-none"
              />
            </label>

            <label className="block space-y-1">
              <span className="pib-label">Tags</span>
              <input
                value={labels}
                onChange={(event) => setLabels(event.target.value)}
                placeholder="design, blocked, client"
                className="w-full min-w-0 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:border-[var(--color-accent-v2)] focus:outline-none"
              />
            </label>

            <div>
              <p className="mb-2 pib-label">{isAdminSurface ? 'Admin context' : 'Context'}</p>
              <ContextReferencePicker
                orgId={orgId}
                projectId={projectId}
                value={contextRefs}
                onChange={setContextRefs}
                inputLabel={isAdminSurface ? 'Add admin task context reference' : 'Add task context reference'}
                compact
              />
            </div>

            <div>
              <p className="mb-2 pib-label">{isAdminSurface ? 'Operator assignment' : 'Assignment'}</p>
              {!hideAgentSection && (
                <div className="mb-2 grid grid-cols-1 gap-1 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] p-1 sm:grid-cols-3">
                  {(['people', 'agent', 'orchestration'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setAssignmentMode(mode)
                        if (mode === 'people') setAssigneeAgentId('')
                        else {
                          setAssigneeIds([])
                          setMentionIds([])
                          if (mode === 'orchestration') setAssigneeAgentId('pip')
                          if (mode === 'agent' && !assigneeAgentId) setAssigneeAgentId(activeAgents(agents)[0]?.agentId ?? '')
                        }
                      }}
                      className={`rounded px-2 py-1.5 text-[11px] font-label capitalize transition-colors ${
                        assignmentMode === mode
                          ? 'bg-[var(--color-accent-v2)] text-black'
                          : 'text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              )}
              {assignmentMode === 'people' || hideAgentSection ? (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] p-2">
                {members.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-[var(--color-pib-text-muted)]">No team members found.</p>
                ) : (
                  members.map((member) => (
                    <label key={member.userId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-row-hover)]">
                      <input
                        type="checkbox"
                        checked={assigneeIds.includes(member.userId)}
                        onChange={() => setAssigneeIds((current) => toggleValue(current, member.userId))}
                        className="accent-[var(--color-accent-v2)]"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-pib-text)]">{memberLabel(member)}</span>
                    </label>
                  ))
                )}
              </div>
              ) : assignmentMode === 'agent' ? (
                <div className="space-y-1 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] p-2">
                  {activeAgents(agents).length === 0 ? (
                    <p className="px-2 py-2 text-xs text-[var(--color-pib-text-muted)]">No agents available.</p>
                  ) : (
                    activeAgents(agents).map((agent) => (
                      <label key={agent.agentId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-row-hover)]">
                        <input
                          type="radio"
                          checked={assigneeAgentId === agent.agentId}
                          onChange={() => setAssigneeAgentId(agent.agentId)}
                          className="accent-[var(--color-accent-v2)]"
                        />
                        <Icon name={agent.iconKey ?? 'smart_toy'} />
                        <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-pib-text)]">{agentLabel(agent)}</span>
                        {agent.lastHealthStatus && (
                          <span className={`h-1.5 w-1.5 rounded-md ${
                            agent.lastHealthStatus === 'ok' ? 'bg-emerald-400' : agent.lastHealthStatus === 'degraded' ? 'bg-[var(--st-warning)]/15' : 'bg-red-400'
                          }`} />
                        )}
                      </label>
                    ))
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] p-2">
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5">
                    <input
                      type="radio"
                      checked
                      readOnly
                      className="accent-[var(--color-accent-v2)]"
                    />
                    <Icon name="hub" />
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-pib-text)]">Pip orchestration</span>
                  </label>
                </div>
              )}
              {!hideAgentSection && assigneeAgentId && assignmentMode !== 'people' && (
                <div className="mt-3 grid gap-2 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] p-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="block pib-label">Effort</span>
                    <select
                      value={agentEffort}
                      onChange={(event) => setAgentEffort(event.target.value as AgentEffort | '')}
                      className="w-full min-w-0 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-2 py-2 text-xs text-[var(--color-pib-text)] focus:border-[var(--color-accent-v2)] focus:outline-none"
                    >
                      <option value="">Auto</option>
                      {AGENT_EFFORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block pib-label">Model</span>
                    <select
                      value={agentModel}
                      onChange={(event) => setAgentModel(event.target.value as AgentModel | '')}
                      className="w-full min-w-0 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-2 py-2 text-xs text-[var(--color-pib-text)] focus:border-[var(--color-accent-v2)] focus:outline-none"
                    >
                      <option value="">Auto</option>
                      {AGENT_MODEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 sm:col-span-2">
                    <span className="block pib-label">LLM credentials</span>
                    <select
                      value={llmCredentialSource}
                      onChange={(event) => setLlmCredentialSource(event.target.value as TaskLlmCredentialSource | '')}
                      className="w-full min-w-0 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-2 py-2 text-xs text-[var(--color-pib-text)] focus:border-[var(--color-accent-v2)] focus:outline-none"
                    >
                      <option value="">Auto (personal if allowed, else organisation)</option>
                      <option value="org">Organisation VPS credentials</option>
                      <option value="personal">My personal credentials</option>
                    </select>
                    <span className="block text-[10px] text-[var(--color-pib-text-muted)]">
                      Personal requires Team access “personal LLM on organisation VPS” and a connected provider in Settings.
                    </span>
                  </label>
                </div>
              )}
              {selectedMembers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedMembers.map((member) => (
                    <button
                      key={member.userId}
                      type="button"
                      onClick={() => setMentionIds((current) => toggleValue(current, member.userId))}
                      className={`rounded-md px-2 py-1 text-[10px] ${
                        mentionIds.includes(member.userId)
                          ? 'bg-[var(--color-accent-v2)] text-black'
                          : 'bg-[var(--color-pib-surface-2)] text-[var(--color-pib-text-muted)]'
                      }`}
                    >
                      @{memberLabel(member)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 pib-label">Dependencies</p>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] p-2">
                {existingTasks.filter((item) => item.id).length === 0 ? (
                  <p className="px-2 py-2 text-xs text-[var(--color-pib-text-muted)]">No existing tasks to depend on.</p>
                ) : existingTasks.filter((item) => item.id).map((item) => (
                  <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-row-hover)]">
                    <input
                      type="checkbox"
                      checked={dependsOn.includes(item.id)}
                      onChange={() => setDependsOn((current) => toggleValue(current, item.id))}
                      className="accent-[var(--color-accent-v2)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-pib-text)]">{item.title}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 pib-label">Review by</p>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] p-2">
                {members.map((member) => (
                  <label key={member.userId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-row-hover)]">
                    <input
                      type="checkbox"
                      checked={reviewerIds.includes(member.userId)}
                      onChange={() => setReviewerIds((current) => toggleValue(current, member.userId))}
                      className="accent-[var(--color-accent-v2)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-pib-text)]">{memberLabel(member)}</span>
                  </label>
                ))}
                {!hideAgentSection && activeAgents(agents).map((agent) => (
                  <label key={agent.agentId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-row-hover)]">
                    <input
                      type="radio"
                      name="reviewerAgent"
                      checked={reviewerAgentId === agent.agentId}
                      onChange={() => setReviewerAgentId(reviewerAgentId === agent.agentId ? '' : agent.agentId)}
                      className="accent-[var(--color-accent-v2)]"
                    />
                    <Icon name={agent.iconKey ?? 'rate_review'} />
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-pib-text)]">{agentLabel(agent)}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-3 rounded-md border border-purple-400/20 bg-purple-500/5 p-3">
              <p className="pib-label">Review model</p>
              <label className="block space-y-1">
                <span className="pib-label">Required capability</span>
                <input
                  value={requiredCapability}
                  onChange={(event) => setRequiredCapability(event.target.value)}
                  placeholder="platform-engineering"
                  className="w-full min-w-0 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:border-[var(--color-accent-v2)] focus:outline-none"
                />
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="pib-label">Risk</span>
                  <select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value as (typeof RISK_LEVELS)[number] | '')} className="w-full rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] px-2 py-2 text-xs text-[var(--color-pib-text)] focus:border-[var(--color-accent-v2)] focus:outline-none">
                    <option value="">Unset</option>
                    {RISK_LEVELS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="pib-label">Approval gate</span>
                  <select value={approvalGate} onChange={(event) => setApprovalGate(event.target.value as (typeof APPROVAL_GATES)[number] | '')} className="w-full rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] px-2 py-2 text-xs text-[var(--color-pib-text)] focus:border-[var(--color-accent-v2)] focus:outline-none">
                    <option value="">Unset</option>
                    {APPROVAL_GATES.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
              </div>
              <label className="block space-y-1">
                <span className="pib-label">Expected artifacts</span>
                <textarea value={expectedArtifactsText} onChange={(event) => setExpectedArtifactsText(event.target.value)} placeholder="One artifact per line" rows={3} className="w-full resize-y rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] px-3 py-2 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:border-[var(--color-accent-v2)] focus:outline-none" />
              </label>
              <label className="block space-y-1">
                <span className="pib-label">Verifier checklist</span>
                <textarea value={verifierChecklistText} onChange={(event) => setVerifierChecklistText(event.target.value)} placeholder="One verification check per line" rows={3} className="w-full resize-y rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] px-3 py-2 text-xs text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] focus:border-[var(--color-accent-v2)] focus:outline-none" />
              </label>
              <p className="text-[10px] leading-snug text-[var(--color-pib-text-muted)]">Review status is quality control. Approval gate is business authority and still requires explicit approval before gated actions.</p>
            </div>
          </aside>
        </div>

        {error && <p className="border-t border-[var(--color-pib-line)] px-5 py-3 text-xs text-[#ef4444]">{error}</p>}

        <footer data-testid="task-composer-footer" className="flex flex-col-reverse items-stretch justify-end gap-2 border-t border-[var(--color-pib-line)] px-5 py-4 sm:flex-row sm:items-center">
          <button type="button" onClick={() => { reset(); onClose() }} disabled={saving} className="pib-btn-secondary w-full text-sm font-label sm:w-auto">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={!canSave} className="pib-btn-primary w-full text-sm font-label disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
            {saving ? 'Creating...' : 'Create task'}
          </button>
        </footer>
      </section>
    </div>
  )
}
