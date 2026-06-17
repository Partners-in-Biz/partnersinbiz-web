export type BlockerTaskLike = {
  id: string
  title?: string
  columnId?: string | null
  agentStatus?: string | null
  assigneeAgentId?: string | null
  agentInput?: { spec?: string; context?: Record<string, unknown> } | null
  agentOutput?: { summary?: string } | null
  dependsOn?: string[]
  approvalGateTaskId?: string | null
  reviewStatus?: string | null
  labels?: string[]
}

export type BlockerComment = {
  text: string
  userName?: string
  userRole?: string
  createdAt?: { _seconds?: number; seconds?: number; _nanoseconds?: number } | string | number | null
}

export type BlockedTaskRecovery = {
  isBlocked: boolean
  sourceText: string
  whatIsWrong: string
  whoCanUnblock: string
  requiredEvidence: string
  messageForAgent: string
  canShowUnblockAction: boolean
  needsPeet: boolean
  blockingReason: string
  continueActionLabel: string
}

export type DependencyStatus = {
  id: string
  title?: string
  columnId?: string | null
  agentStatus?: string | null
  reviewStatus?: string | null
}

const HUMAN_WAITING_PATTERNS = [
  /waiting on .*\b(approval|confirmation|confirm|sign[- ]?off|human|client|peet)\b/i,
  /\b(needs?|requires?)\s+(approval|confirmation|sign[- ]?off|human input|client input)\b/i,
  /\b(awaiting|pending)\s+(approval|confirmation|sign[- ]?off|client|human)\b/i,
]

function timestampMillis(value: BlockerComment['createdAt']): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (value && typeof value === 'object') {
    const seconds = value._seconds ?? value.seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function latestBlockerText(comments: BlockerComment[]): string | null {
  const candidates = comments
    .filter((comment) => /block|waiting|awaiting|approval|confirm|cannot|can't|needs?/i.test(comment.text))
    .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt))
  return candidates[0]?.text?.trim() || null
}

function normalize(text: string): string {
  return text.replace(/^\s*(blocked|blocker|reason|status)\s*:\s*/i, '').trim()
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const value = match?.[1]?.trim()
    if (value) return value.replace(/[.\n]+$/, '').trim()
  }
  return null
}

function sentenceContaining(text: string, pattern: RegExp): string | null {
  const sentences = text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean)
  return sentences.find((sentence) => pattern.test(sentence)) ?? null
}

function inferWhoCanUnblock(text: string, task: BlockerTaskLike): string {
  const explicit = firstMatch(text, [
    /who can unblock\s*:\s*([^\n]+)/i,
    /unblocker\s*:\s*([^\n]+)/i,
    /waiting on\s+([^.;\n]+)/i,
  ])
  if (explicit) return explicit
  if (/approval|confirm|sign[- ]?off/i.test(text)) return 'An authorised user must confirm or approve this in Projects/Kanban.'
  if (/credential|secret|api key|access/i.test(text)) return 'A workspace admin with access to the required credentials or permissions.'
  return task.assigneeAgentId ? `${task.assigneeAgentId} needs the missing input before it can continue.` : 'The task owner or an authorised workspace user.'
}

function inferEvidence(text: string): string {
  return firstMatch(text, [
    /proof needed\s*:\s*([^\n]+)/i,
    /evidence required\s*:\s*([^\n]+)/i,
    /required evidence\s*:\s*([^\n]+)/i,
  ]) ?? sentenceContaining(text, /proof|evidence|screenshot|link|artifact|confirmation/i) ?? 'Add a comment or attachment showing the blocker is resolved.'
}

function inferAgentMessage(text: string): string {
  return firstMatch(text, [
    /when resolved tell [^:]+:\s*([^\n]+)/i,
    /message for agent\s*:\s*([^\n]+)/i,
    /agent needs\s*:\s*([^\n]+)/i,
  ]) ?? 'Comment with what changed, who approved it, and any evidence link or attachment so the agent can safely continue.'
}

function inferBlockingReason(text: string): string {
  return firstMatch(text, [
    /exact blocker\s*:\s*([^\n.]+)/i,
    /blocking reason\s*:\s*([^\n.]+)/i,
    /blocked because\s*([^\n.]+)/i,
    /cannot continue (?:because|until)\s*([^\n.]+)/i,
    /waiting on\s+([^\n.]+)/i,
    /awaiting\s+([^\n.]+)/i,
  ]) ?? sentenceContaining(text, /approval|input|missing|waiting|awaiting|cannot continue|blocked/i) ?? text
}

function needsPeetAttention(text: string, task: BlockerTaskLike): boolean {
  const haystack = `${text} ${(task.labels ?? []).join(' ')} ${task.agentStatus ?? ''} ${task.reviewStatus ?? ''}`
  if (/\bpeet\b/i.test(haystack)) return true
  if (task.agentStatus === 'awaiting-input') return true
  if (/approval|sign[- ]?off|human input|missing input|authorised user|requires confirmation|waiting on/i.test(haystack)) return true
  return false
}

function continueActionLabel(needsPeet: boolean, text: string): string {
  if (!needsPeet) return 'Continue'
  if (/approval|approve|sign[- ]?off/i.test(text)) return 'Approve / continue safely'
  return 'Provide input / continue safely'
}

function canShowUnblockAction(text: string, task: BlockerTaskLike): boolean {
  if (task.agentStatus === 'awaiting-input') return true
  if (task.reviewStatus === 'pending') return true
  if (task.labels?.some((label) => /approval|confirmation|awaiting-input|human/i.test(label))) return true
  return HUMAN_WAITING_PATTERNS.some((pattern) => pattern.test(text))
}

export function buildBlockedTaskRecovery(task: BlockerTaskLike, comments: BlockerComment[] = []): BlockedTaskRecovery {
  const isBlocked = task.columnId === 'blocked' || task.agentStatus === 'blocked' || task.agentStatus === 'awaiting-input'
  const sourceText = latestBlockerText(comments)
    ?? (typeof task.agentOutput?.summary === 'string' ? task.agentOutput.summary.trim() : '')
    ?? ''
  const fallback = task.agentInput?.spec ? `The agent could not continue this task. Original request: ${task.agentInput.spec}` : 'The agent could not continue until the blocker is resolved.'
  const guidance = normalize(sourceText || fallback)
  const peetAttention = needsPeetAttention(guidance, task)
  const blockingReason = inferBlockingReason(guidance)

  return {
    isBlocked,
    sourceText: guidance,
    whatIsWrong: guidance,
    whoCanUnblock: inferWhoCanUnblock(guidance, task),
    requiredEvidence: inferEvidence(guidance),
    messageForAgent: inferAgentMessage(guidance),
    canShowUnblockAction: isBlocked && canShowUnblockAction(guidance, task),
    needsPeet: isBlocked && peetAttention,
    blockingReason,
    continueActionLabel: continueActionLabel(peetAttention, guidance),
  }
}

function isDone(task: DependencyStatus | undefined): boolean {
  if (!task) return false
  return task.columnId === 'done' || task.agentStatus === 'done' || task.reviewStatus === 'approved'
}

function isBlocked(task: DependencyStatus | undefined): boolean {
  if (!task) return false
  return task.columnId === 'blocked' || task.agentStatus === 'blocked' || task.agentStatus === 'awaiting-input'
}

function taskLabel(task: DependencyStatus | undefined, id: string): string {
  return task?.title?.trim() || id
}

export function evaluateUnblockReadiness(
  task: Pick<BlockerTaskLike, 'dependsOn' | 'approvalGateTaskId'>,
  relatedTasks: DependencyStatus[],
): { ready: boolean; reasons: string[] } {
  const byId = new Map(relatedTasks.map((related) => [related.id, related]))
  const reasons: string[] = []

  for (const depId of task.dependsOn ?? []) {
    const dep = byId.get(depId)
    const label = taskLabel(dep, depId)
    if (!dep) reasons.push(`Dependency “${label}” could not be found.`)
    else if (isBlocked(dep)) reasons.push(`Dependency “${label}” is still blocked.`)
    else if (!isDone(dep)) reasons.push(`Dependency “${label}” is not complete yet.`)
  }

  if (task.approvalGateTaskId) {
    const gate = byId.get(task.approvalGateTaskId)
    const label = taskLabel(gate, task.approvalGateTaskId)
    if (!gate) reasons.push(`Approval gate “${label}” could not be found.`)
    else if (gate.reviewStatus !== 'approved' && gate.columnId !== 'done') reasons.push(`Approval gate “${label}” is not approved yet.`)
  }

  return { ready: reasons.length === 0, reasons }
}
