'use client'

import { useMemo, useRef, useState } from 'react'
import VoiceInputButton from '@/components/chat/VoiceInputButton'
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
  onClose: () => void
  onCreated: (task: Task) => void
}

const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const
type AssignmentMode = 'people' | 'agent' | 'orchestration'

function cleanList(value: string): string[] {
  return value
    .split(',')
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

export function TaskComposer({ open, column, projectId, orgId, members, agents = [], existingTasks = [], hideAgentSection = false, onClose, onCreated }: TaskComposerProps) {
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
  const [dependsOn, setDependsOn] = useState<string[]>([])
  const [reviewerIds, setReviewerIds] = useState<string[]>([])
  const [reviewerAgentId, setReviewerAgentId] = useState<AgentId | ''>('')
  const [checklistText, setChecklistText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mouseDownOnBackdrop = useRef(false)

  const canSave = title.trim().length > 0 && !saving
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
    setDependsOn([])
    setReviewerIds([])
    setReviewerAgentId('')
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
        dependsOn,
        reviewerIds,
        reviewerAgentId: reviewerAgentId || null,
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
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget }}
      onClick={() => { if (mouseDownOnBackdrop.current) onClose() }}
    >
      <div className="absolute inset-0 bg-black/70" />
      <section
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-[var(--color-sidebar)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-[var(--color-card-border)] px-5 py-4">
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
              {column.name}
            </p>
            <h2 className="text-lg font-headline font-bold text-on-surface">New task</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-on-surface-variant hover:bg-[var(--color-surface-container)] hover:text-on-surface"
            title="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </header>

        <div className="grid flex-1 gap-0 overflow-y-auto lg:grid-cols-[1fr_320px]">
          <div className="space-y-4 p-5">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Task title"
              className="w-full rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] px-4 py-3 text-lg font-headline font-bold text-on-surface placeholder:text-on-surface-variant focus:border-[var(--color-accent-v2)] focus:outline-none"
              autoFocus
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Description</p>
                <VoiceInputButton
                  disabled={saving}
                  onTranscript={addVoiceTranscriptToDescription}
                  className="border border-[var(--color-card-border)] bg-[var(--color-card)]"
                />
              </div>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Description, goals, acceptance criteria, blockers..."
                rows={7}
                className="w-full resize-y rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] px-4 py-3 text-sm leading-relaxed text-on-surface placeholder:text-on-surface-variant focus:border-[var(--color-accent-v2)] focus:outline-none"
              />
            </div>

            <div>
              <p className="mb-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Checklist</p>
              <textarea
                value={checklistText}
                onChange={(event) => setChecklistText(event.target.value)}
                placeholder="One item per line"
                rows={4}
                className="w-full resize-y rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-[var(--color-accent-v2)] focus:outline-none"
              />
            </div>

            <div>
              <p className="mb-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Attachments</p>
              <label
                onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  addFiles(event.dataTransfer.files)
                }}
                className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors"
                style={{
                  borderColor: dragging ? 'var(--color-accent-v2)' : 'var(--color-card-border)',
                  background: dragging ? 'color-mix(in oklab, var(--color-accent-v2) 8%, transparent)' : 'var(--color-card)',
                }}
              >
                <span className="material-symbols-outlined text-[28px] text-on-surface-variant">cloud_upload</span>
                <span className="mt-2 text-sm text-on-surface">Upload images, videos, documents</span>
                <span className="mt-1 text-xs text-on-surface-variant">Firebase Storage</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files) addFiles(event.target.files)
                    event.currentTarget.value = ''
                  }}
                />
              </label>
              {files.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {files.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] p-2">
                      <span className="material-symbols-outlined text-[18px] text-on-surface-variant">
                        {fileKind(file) === 'image' ? 'image' : fileKind(file) === 'video' ? 'movie' : 'attach_file'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-on-surface">{file.name}</p>
                        <p className="text-[10px] text-on-surface-variant">{formatSize(file.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                        className="grid h-7 w-7 place-items-center rounded text-on-surface-variant hover:bg-[var(--color-surface-container)] hover:text-on-surface"
                        title="Remove file"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-5 border-t border-[var(--color-card-border)] p-5 lg:border-l lg:border-t-0">
            <div>
              <p className="mb-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Priority</p>
              <div className="grid grid-cols-2 gap-2">
                {PRIORITIES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setPriority(item)}
                    className={`rounded-md border px-3 py-2 text-xs font-label capitalize transition-colors ${
                      priority === item
                        ? 'border-[var(--color-accent-v2)] bg-[var(--color-accent-v2)] text-black'
                        : 'border-[var(--color-card-border)] text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Start</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="w-full rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface focus:border-[var(--color-accent-v2)] focus:outline-none"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Due</span>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="w-full rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface focus:border-[var(--color-accent-v2)] focus:outline-none"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Estimate</span>
              <input
                type="number"
                min="0"
                step="0.25"
                value={estimateHours}
                onChange={(event) => setEstimateHours(event.target.value)}
                placeholder="Hours"
                className="w-full rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-[var(--color-accent-v2)] focus:outline-none"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Tags</span>
              <input
                value={labels}
                onChange={(event) => setLabels(event.target.value)}
                placeholder="design, blocked, client"
                className="w-full rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:border-[var(--color-accent-v2)] focus:outline-none"
              />
            </label>

            <div>
              <p className="mb-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Assignment</p>
              {!hideAgentSection && (
                <div className="mb-2 grid grid-cols-3 gap-1 rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] p-1">
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
                          : 'text-on-surface-variant hover:bg-[var(--color-surface-container)] hover:text-on-surface'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              )}
              {assignmentMode === 'people' || hideAgentSection ? (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] p-2">
                {members.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-on-surface-variant">No team members found.</p>
                ) : (
                  members.map((member) => (
                    <label key={member.userId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-surface-container)]">
                      <input
                        type="checkbox"
                        checked={assigneeIds.includes(member.userId)}
                        onChange={() => setAssigneeIds((current) => toggleValue(current, member.userId))}
                        className="accent-[var(--color-accent-v2)]"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-on-surface">{memberLabel(member)}</span>
                    </label>
                  ))
                )}
              </div>
              ) : assignmentMode === 'agent' ? (
                <div className="space-y-1 rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] p-2">
                  {activeAgents(agents).length === 0 ? (
                    <p className="px-2 py-2 text-xs text-on-surface-variant">No agents available.</p>
                  ) : (
                    activeAgents(agents).map((agent) => (
                      <label key={agent.agentId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-surface-container)]">
                        <input
                          type="radio"
                          checked={assigneeAgentId === agent.agentId}
                          onChange={() => setAssigneeAgentId(agent.agentId)}
                          className="accent-[var(--color-accent-v2)]"
                        />
                        <span className="material-symbols-outlined text-[16px] text-on-surface-variant">
                          {agent.iconKey ?? 'smart_toy'}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-on-surface">{agentLabel(agent)}</span>
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
                <div className="rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] p-2">
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5">
                    <input
                      type="radio"
                      checked
                      readOnly
                      className="accent-[var(--color-accent-v2)]"
                    />
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">hub</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-on-surface">Pip orchestration</span>
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
                      className={`rounded-full px-2 py-1 text-[10px] ${
                        mentionIds.includes(member.userId)
                          ? 'bg-[var(--color-accent-v2)] text-black'
                          : 'bg-[var(--color-surface-container)] text-on-surface-variant'
                      }`}
                    >
                      @{memberLabel(member)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Dependencies</p>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] p-2">
                {existingTasks.filter((item) => item.id).length === 0 ? (
                  <p className="px-2 py-2 text-xs text-on-surface-variant">No existing tasks to depend on.</p>
                ) : existingTasks.filter((item) => item.id).map((item) => (
                  <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-surface-container)]">
                    <input
                      type="checkbox"
                      checked={dependsOn.includes(item.id)}
                      onChange={() => setDependsOn((current) => toggleValue(current, item.id))}
                      className="accent-[var(--color-accent-v2)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-on-surface">{item.title}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Review by</p>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] p-2">
                {members.map((member) => (
                  <label key={member.userId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-surface-container)]">
                    <input
                      type="checkbox"
                      checked={reviewerIds.includes(member.userId)}
                      onChange={() => setReviewerIds((current) => toggleValue(current, member.userId))}
                      className="accent-[var(--color-accent-v2)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-on-surface">{memberLabel(member)}</span>
                  </label>
                ))}
                {!hideAgentSection && activeAgents(agents).map((agent) => (
                  <label key={agent.agentId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--color-surface-container)]">
                    <input
                      type="radio"
                      name="reviewerAgent"
                      checked={reviewerAgentId === agent.agentId}
                      onChange={() => setReviewerAgentId(reviewerAgentId === agent.agentId ? '' : agent.agentId)}
                      className="accent-[var(--color-accent-v2)]"
                    />
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">{agent.iconKey ?? 'rate_review'}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-on-surface">{agentLabel(agent)}</span>
                  </label>
                ))}
              </div>
            </div>
          </aside>
        </div>

        {error && <p className="border-t border-[var(--color-card-border)] px-5 py-3 text-xs text-[#ef4444]">{error}</p>}

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--color-card-border)] px-5 py-4">
          <button type="button" onClick={() => { reset(); onClose() }} disabled={saving} className="pib-btn-secondary text-sm font-label">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={!canSave} className="pib-btn-primary text-sm font-label disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? 'Creating...' : 'Create task'}
          </button>
        </footer>
      </section>
    </div>
  )
}
