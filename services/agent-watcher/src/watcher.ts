/**
 * Firestore onSnapshot listener + dispatch coordinator.
 *
 * Subscribes to all tasks (collectionGroup) where assigneeAgentId is an enabled
 * agent and
 * agentStatus = 'pending'. For each added/modified doc, attempts to claim it and run
 * it on Hermes. In-flight task IDs are tracked so rapid snapshot updates don't double-process.
 *
 * Concurrency cap: 5 active dispatches per agent.
 */
import crypto from 'node:crypto'
import type { DocumentReference, DocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore'
import { db, FieldValue } from './firestore'
import { AGENT_IDS, getAgentConfig, loadEnabledAgentIds, type AgentConfig, type AgentId } from './config'
import { claimReviewTask, claimTask, startHeartbeat } from './claim'
import { runAndPoll, type TaskDispatchInput } from './hermes'
import { resolveWatcherLlmRoute, resolveWatcherRuntimePreference } from './llm-routing'
import {
  resolveLinkedComputerDispatchTarget,
  runKanbanLinkedAndPoll,
  type LinkedDeviceDispatchTarget,
} from './linked-run'
import { formatHermesWatcherError } from './hermes-error'
import { logger } from './logger'
import type { AgentRunTelemetry } from './run-telemetry'
import { agentStatusUpdate } from './task-updates'
import { assessCompletionIntegrity, validateCompletionEvidence, verifyChangedFilesMatchCommit, verifyCleanWatcherWorktree, verifyReachableDevelopmentCommit } from './completion-integrity'
import {
  getTaskDependencyGateIds,
  getTaskDispatchBlocker,
  getUnresolvedTaskDependencyGateIds,
  hasPendingApprovalGate,
  hasPendingScheduledRelease,
  releaseMillis,
  type DependencyState,
} from './eligibility'
import { buildCeoDataDecisionOperatingRule as buildSharedCeoDataDecisionOperatingRule } from './ceo-operating-rule'
import { buildDesignContextPromptBlock } from './design-context'
import { buildSurfaceModePromptBlock } from './surface-modes'
import { notifyCommandSessionFromTask } from './command-session'
import { buildCompletionArtifacts, notifyWorkflowGraphTerminal } from './workflow-writeback'
import { buildWatcherPromptBudget } from './prompt-budget'
import { prepareWatcherTaskWorktree, type WatcherWorktreeResult } from './repository-isolation'


function expectedArtifactsFromTask(taskData: TaskData): string[] | undefined {
  const top = Array.isArray(taskData.expectedArtifacts)
    ? taskData.expectedArtifacts.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : []
  if (top.length > 0) return top
  const ctx = taskData.agentInput?.context
  const nested = ctx && Array.isArray(ctx.expectedArtifacts)
    ? ctx.expectedArtifacts.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : []
  return nested.length > 0 ? nested : undefined
}

function normalizeArtifactList(value: unknown): Array<{ type: string; ref: string; label?: string }> {
  if (!Array.isArray(value)) return []
  const out: Array<{ type: string; ref: string; label?: string }> = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const type = typeof rec.type === 'string' ? rec.type.trim() : ''
    const ref = typeof rec.ref === 'string' ? rec.ref.trim() : ''
    if (!type || !ref) continue
    const label = typeof rec.label === 'string' && rec.label.trim() ? rec.label.trim() : undefined
    out.push(label ? { type, ref, label } : { type, ref })
  }
  return out
}

/**
 * Build completion agentOutput without wiping producer-patched artifacts.
 * Race class: Hermes run ends after Quinn PATCH cleanAgentOutput(artifacts) →
 * summary/telemetry-only replace thrash. Always re-read live store and merge.
 */
async function buildMergedDoneAgentOutput(input: {
  taskRef: DocumentReference
  taskData: TaskData
  summary: string
  telemetry: AgentRunTelemetry | Record<string, unknown> | null | undefined
}): Promise<Record<string, unknown>> {
  const liveSnap = await input.taskRef.get().catch(() => null)
  const liveData = (liveSnap?.data() ?? input.taskData) as TaskData
  const liveAo =
    liveData.agentOutput && typeof liveData.agentOutput === 'object'
      ? ({ ...liveData.agentOutput } as Record<string, unknown>)
      : {}
  const claimAo =
    input.taskData.agentOutput && typeof input.taskData.agentOutput === 'object'
      ? ({ ...input.taskData.agentOutput } as Record<string, unknown>)
      : {}
  const mergedBase: Record<string, unknown> = { ...claimAo, ...liveAo }
  const summary = (input.summary || '').trim() || (typeof mergedBase.summary === 'string' ? mergedBase.summary : '')
  if (summary) mergedBase.summary = summary

  const expected = expectedArtifactsFromTask(liveData) ?? expectedArtifactsFromTask(input.taskData)
  const built = buildCompletionArtifacts({
    agentOutput: mergedBase,
    summary,
    expectedArtifacts: expected,
  })
  const liveArtifacts = normalizeArtifactList(liveAo.artifacts)
  const claimArtifacts = normalizeArtifactList(claimAo.artifacts)
  // Prefer non-empty structured arrays already on the store (producer dual-hold gold).
  const artifacts =
    liveArtifacts.length > 0
      ? liveArtifacts
      : built.length > 0
        ? built
        : claimArtifacts

  const doneAgentOutput: Record<string, unknown> = {
    summary: summary || 'Task completed',
    completedAt: new Date().toISOString(),
  }
  if (input.telemetry && typeof input.telemetry === 'object') {
    doneAgentOutput.telemetry = input.telemetry
  }
  // Preserve producer typed top-level keys (go_no_go, commit, etc.) when present.
  for (const [key, value] of Object.entries(mergedBase)) {
    if (key === 'summary' || key === 'telemetry' || key === 'completedAt' || key === 'artifacts') continue
    if (typeof value === 'string' && value.trim()) doneAgentOutput[key] = value.trim()
  }
  if (artifacts.length > 0) {
    doneAgentOutput.artifacts = artifacts
    for (const item of artifacts) {
      if (!doneAgentOutput[item.type]) doneAgentOutput[item.type] = item.ref
    }
  }
  return doneAgentOutput
}


const MAX_CONCURRENT_PER_AGENT = 5
const READY_TASK_SWEEP_MS = 60_000
const MAX_READY_SWEEP_DOCS = 100
const MAX_SCHEDULED_RELEASE_SWEEP_DOCS = 100
const MAX_DEPENDENCY_RELEASE_SWEEP_DOCS = 100
const MAX_TRANSIENT_RETRIES = 3
// Normal provider blips stay short. Mid-run gateway loss / 502 storms need a
// longer cool-down so the watcher does not re-claim while local-runtime is
// still bouncing the profile.
const TRANSIENT_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const
const GATEWAY_STORM_RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000, 30 * 60_000] as const

const inFlight = new Set<string>()
const perAgentInFlight = new Map<AgentId, number>()
const deferredByAgent = new Map<AgentId, Map<string, { ref: DocumentReference; data: TaskData }>>()
let activeAgentIds = new Set<string>(AGENT_IDS)
let scheduledReleaseSweepDisabled = false

function incAgent(agentId: AgentId): void {
  perAgentInFlight.set(agentId, (perAgentInFlight.get(agentId) ?? 0) + 1)
}
function decAgent(agentId: AgentId): void {
  const cur = perAgentInFlight.get(agentId) ?? 0
  perAgentInFlight.set(agentId, Math.max(0, cur - 1))
}

function currentAgentIds(): string[] {
  return Array.from(activeAgentIds).sort()
}

function isActiveAgentId(agentId: unknown): agentId is AgentId {
  return typeof agentId === 'string' && activeAgentIds.has(agentId)
}

function chunkAgentIds(agentIds: string[], size = 30): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < agentIds.length; index += size) {
    chunks.push(agentIds.slice(index, index + size))
  }
  return chunks.length > 0 ? chunks : [Array.from(AGENT_IDS)]
}

function completionStateFingerprint(task: TaskData): string {
  const agentOutput = task.agentOutput && typeof task.agentOutput === 'object'
    ? { ...(task.agentOutput as Record<string, unknown>) }
    : null
  if (agentOutput) {
    // Producer dual-hold may patch artifacts/telemetry while verification runs;
    // those are merged into the final output and must not trip the claim guard.
    delete agentOutput.artifacts
    delete agentOutput.telemetry
    delete agentOutput.completedAt
  }
  return JSON.stringify({
    completionEvidence: task.completionEvidence ?? null,
    agentStatus: task.agentStatus ?? null,
    status: task.status ?? null,
    columnId: task.columnId ?? null,
    assigneeAgentId: task.assigneeAgentId ?? null,
    assignedTo: task.assignedTo ?? null,
    reviewerAgentId: task.reviewerAgentId ?? null,
    reviewerIds: task.reviewerIds ?? null,
    reviewStatus: task.reviewStatus ?? null,
    agentOutput,
  })
}

function taskHasAssignedReviewer(task: TaskData): boolean {
  return Boolean(
    (typeof task.reviewerAgentId === 'string' && task.reviewerAgentId.trim())
    || (Array.isArray(task.reviewerIds) && task.reviewerIds.some((id) => typeof id === 'string' && id.trim())),
  )
}

interface TaskData {
  orgId?: string
  projectId?: string
  assigneeAgentId?: string
  assignedTo?: { type?: string; id?: string } | null
  agentStatus?: string
  agentInput?: { spec?: string; context?: Record<string, unknown>; constraints?: string[] }
  dependsOn?: string[]
  approvalGateTaskId?: string
  title?: string
  columnId?: string
  reviewerAgentId?: string
  reviewerIds?: string[]
  reviewStatus?: string
  agentOutput?: { summary?: string; artifacts?: unknown[]; telemetry?: unknown; [key: string]: unknown }
  completionEvidence?: unknown
  completionVerification?: { verifierIdentity?: string; verifierResult?: string; reasons?: string[]; commitReachable?: boolean | null; changedFilesMatch?: boolean | null }
  agentConversationId?: string
  /** Stable key for the current logical task-dispatch attempt. */
  agentDispatchKey?: string
  agentDispatchFailure?: Record<string, unknown>
  workflowRunId?: string
  workflowNodeId?: string
  status?: string
  deleted?: boolean
  requiresApproval?: boolean
  approvalStatus?: string
  approvalGate?: string | { status?: string }
  labels?: string[]
  agentReleaseAt?: string | number | { toMillis?: () => number; toDate?: () => Date }
  agentReleaseStatus?: string
  agentReleasedAt?: unknown
  riskLevel?: string
  agentEffort?: string
  agentModel?: string
  agentProvider?: string
  llmCredentialSource?: string
  llmCredentialOwnerUid?: string
  llmResolvedSource?: string
  llmConnectionId?: string
  llmCredentialBindingId?: string
  agentRuntimeTargetId?: string
  requiredCapability?: string
  requestedByAgentId?: string
  expectedArtifacts?: string[]
  verifierChecklist?: string[]
  sourceDocumentId?: string
  sourceDocumentSectionId?: string
  sourceSpecVersion?: string
  sourceResearchItemId?: string
  agentRetryCount?: number
  agentRetryAt?: string | number | { toMillis?: () => number; toDate?: () => Date }
  /** Reviewer-only retry budget; does not requeue the implementer. */
  reviewRetryCount?: number
  reviewRetryAt?: string | number | { toMillis?: () => number; toDate?: () => Date }
  reporterId?: string
  createdBy?: string
  chatOrigin?: {
    conversationId?: string
    requestMessageId?: string
    responseMessageId?: string
    bundleId?: string
    sequence?: number
  }
}

const TRANSIENT_HERMES_ERROR_PATTERNS = [
  /\bconnection error\b/i,
  /\bfetch failed\b/i,
  /\bsocket hang up\b/i,
  /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)\b/i,
  /\b(?:429|502|503|504)\b/,
  /\brate limit(?:ed)?\b/i,
  /\bservice unavailable\b/i,
  /\bprovider (?:is )?(?:overloaded|temporarily unavailable)\b/i,
  /\bwas not found on the agent gateway\b/i,
  /\bautomatic credential sync will retry\b/i,
  /\bProvider authentication failed\b/i,
]

export function isTransientHermesError(error: string): boolean {
  return TRANSIENT_HERMES_ERROR_PATTERNS.some((pattern) => pattern.test(error))
}

const PRE_EXECUTION_FAILOVER_UNSAFE = /\b(approval|approve|send|message|publish|schedule|spend|budget|finance|invoice|payment|delete|archive|secret|config|deploy|release|production|client-visible)\b/i

function isPreExecutionTransportFailure(result: Awaited<ReturnType<typeof runAndPoll>>): boolean {
  // A no-run-id transport error is safe to recover only when deterministic
  // lookup has proved this runtime never accepted the dispatch key.
  return result.dispatchAcceptance === 'not-accepted'
    && !result.runId
    && Boolean(result.error)
    && isTransientHermesError(result.error!)
}

function canRecoverPreExecutionDispatch(input: {
  taskData: TaskData
  result: Awaited<ReturnType<typeof runAndPoll>>
}): boolean {
  const { taskData, result } = input
  if (!isPreExecutionTransportFailure(result)) return false
  if (hasPendingApprovalGate(taskData)) return false
  const riskText = [
    taskData.title,
    taskData.requiredCapability,
    ...(taskData.labels ?? []),
  ].filter(Boolean).join(' ')
  return !PRE_EXECUTION_FAILOVER_UNSAFE.test(riskText)
}

/**
 * This is deliberately narrower than durable retry: the first gateway must not
 * have created a run, so a local fallback cannot duplicate accepted agent work.
 */
function canFailOverPreExecutionDispatch(input: {
  taskData: TaskData
  cfg: AgentConfig | null
  linkedTarget: LinkedDeviceDispatchTarget | null
  credentialRoute: Awaited<ReturnType<typeof resolveWatcherLlmRoute>>
  result: Awaited<ReturnType<typeof runAndPoll>>
}): boolean {
  const { taskData, cfg, linkedTarget, credentialRoute, result } = input
  if (linkedTarget || credentialRoute || !cfg || cfg.targetId !== 'vps') return false
  if (!canRecoverPreExecutionDispatch({ taskData, result })) return false
  // Explicit runtime/model/credential choices must never be silently rerouted.
  if (taskData.agentRuntimeTargetId || taskData.agentModel || taskData.llmConnectionId || taskData.llmCredentialBindingId) return false
  return true
}

export function isGatewayRestartStormError(error: string): boolean {
  return (
    /\bwas not found on the agent gateway\b/i.test(error)
    || /\brun_not_found\b/i.test(error)
    || /\breturned 502 repeatedly while polling\b/i.test(error)
    || /\breturned 503 repeatedly while polling\b/i.test(error)
    || /\bgateway_draining\b/i.test(error)
    || /\baddress already in use\b/i.test(error)
  )
}

function transientRetryAt(retryCount: number, now = Date.now(), error?: string): string {
  const table = error && isGatewayRestartStormError(error)
    ? GATEWAY_STORM_RETRY_DELAYS_MS
    : TRANSIENT_RETRY_DELAYS_MS
  const delay = table[Math.min(retryCount, table.length - 1)]
  return new Date(now + delay).toISOString()
}

function safeDocKey(value: string): string {
  return value.replace(/\//g, '-')
}

/**
 * One Firestore retry count represents one logical dispatch attempt. Hashing the
 * durable identifiers gives Hermes an opaque valid key that survives watcher
 * restarts and VPS→local recovery, without exposing org/task ids in headers.
 */
export function stableTaskDispatchKey(input: {
  orgId: string
  taskId: string
  agentId: string
  attempt: number
}): string {
  const canonical = JSON.stringify({
    v: 1,
    orgId: input.orgId,
    taskId: input.taskId,
    agentId: input.agentId,
    attempt: Math.max(0, Math.trunc(input.attempt) || 0),
  })
  return `pib-dispatch-v1-${crypto.createHash('sha256').update(canonical).digest('hex')}`
}

const HUMAN_BLOCKER_PATTERNS = [
  /\bcannot continue (?:because|until)\b/i,
  /\b(can't|cannot) proceed (?:because|until|without)\b/i,
  /\bneeds? peet\b/i,
  /\bwaiting on (?:peet|human|client|approval|input|confirmation|sign[- ]?off)\b/i,
  /\bawaiting (?:peet|human|client|approval|input|confirmation|sign[- ]?off)\b/i,
  /\bmissing (?:approval|input|confirmation|credential|secret|access|api key)\b/i,
]

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

function outputNeedsHumanInput(output: string): boolean {
  return HUMAN_BLOCKER_PATTERNS.some((pattern) => pattern.test(output))
}

function extractBlockingReason(output: string): string {
  return firstMatch(output, [
    /exact blocker\s*:\s*([^\n.]+)/i,
    /blocking reason\s*:\s*([^\n.]+)/i,
    /blocked because\s*([^\n.]+)/i,
    /cannot continue (?:because|until)\s*([^\n.]+)/i,
    /waiting on\s+([^\n.]+)/i,
    /awaiting\s+([^\n.]+)/i,
  ]) ?? sentenceContaining(output, /approval|input|missing|waiting|awaiting|cannot continue|blocked/i) ?? 'Human approval or missing input is required.'
}

function extractRequiredEvidence(output: string): string {
  return firstMatch(output, [
    /proof needed\s*:\s*([^\n]+)/i,
    /evidence required\s*:\s*([^\n]+)/i,
    /required evidence\s*:\s*([^\n]+)/i,
  ]) ?? sentenceContaining(output, /proof|evidence|approval comment|screenshot|link|artifact|confirmation/i) ?? 'Add an approval/input comment or attachment showing the blocker is resolved.'
}

function extractMessageForAgent(output: string): string {
  return firstMatch(output, [
    /message for agent\s*:\s*([^\n]+)/i,
    /when resolved tell [^:]+:\s*([^\n]+)/i,
    /agent needs\s*:\s*([^\n]+)/i,
  ]) ?? 'Comment with what changed, who approved it, and any evidence link or attachment so the agent can safely continue.'
}

function projectTaskLink(projectId: string | undefined, taskId: string): string {
  return projectId ? `/admin/projects/${projectId}?taskId=${taskId}` : `/admin/projects?taskId=${taskId}`
}

async function notifyNeedsPeet(input: {
  taskId: string
  taskData: TaskData
  agentId: AgentId
  blockingReason: string
  requiredEvidence: string
  messageForAgent: string
  runId: string | null
}): Promise<void> {
  if (!input.taskData.orgId) return
  try {
    const taskTitle = input.taskData.title ?? input.taskId
    const userId = input.taskData.reporterId ?? input.taskData.createdBy ?? null
    const safeContinuePath = 'Provide approval/input evidence in the linked task, then use the safe continue/unblock action. Do not bypass approval gates for production deploys, client-visible sends/publishing, paid spend, finance, secrets/config, or destructive actions.'
    await db.collection('notifications').doc(`agent-needs-peet-${safeDocKey(input.taskData.orgId)}-${safeDocKey(input.taskId)}`).set({
      orgId: input.taskData.orgId,
      userId,
      agentId: input.agentId,
      type: 'task.agent_needs_input',
      title: `Needs Peet: ${input.agentId.charAt(0).toUpperCase() + input.agentId.slice(1)} cannot continue`,
      body: `Task “${taskTitle}” cannot continue. Exact blocker: ${input.blockingReason}. Proof needed: ${input.requiredEvidence}. Message for agent: ${input.messageForAgent}`,
      link: projectTaskLink(input.taskData.projectId, input.taskId),
      data: {
        projectId: input.taskData.projectId ?? null,
        taskId: input.taskId,
        taskTitle,
        runId: input.runId,
        blockerReason: input.blockingReason,
        requiredEvidence: input.requiredEvidence,
        messageForAgent: input.messageForAgent,
        requiredCapability: input.taskData.requiredCapability ?? null,
        safeContinuePath,
        approvalGatesPreserved: ['production-deploy', 'client-visible-send', 'public-publishing', 'paid-spend', 'finance', 'secrets-config', 'destructive-action'],
      },
      status: 'unread',
      priority: /deploy|send|publish|spend|finance|secret|destructive/i.test(`${input.taskData.requiredCapability ?? ''} ${input.blockingReason}`) ? 'urgent' : 'high',
      snoozedUntil: null,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: 'system:agent-watcher',
      createdByType: 'system',
    }, { merge: true })
  } catch (err) {
    logger.warn('failed to create needs-peet notification', {
      taskId: input.taskId,
      agentId: input.agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function fallbackTelemetry(input: TaskDispatchInput): AgentRunTelemetry {
  return {
    provider: null,
    model: input.agentModel ?? null,
    reasoningEffort: input.agentEffort ?? null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
    costUsd: null,
    durationMs: null,
    retryCount: 0,
    toolCallCount: null,
    tokenSource: 'unavailable',
    costSource: 'unavailable',
    exactTokenUsageAvailable: false,
    exactCostAvailable: false,
    exactUsageAvailable: false,
    missing: ['token_usage', 'cost_usd'],
  }
}

async function persistAgentDispatchRun(input: {
  taskRef: DocumentReference
  taskData: TaskData
  agentId: AgentId
  runId: string | null
  telemetry: AgentRunTelemetry
  error: string | null
}): Promise<void> {
  if (!input.runId) return
  try {
    const runId = `agent-task-dispatch:${safeDocKey(input.taskRef.id)}:${safeDocKey(input.runId)}`
    const status = input.error ? 'failed' : 'executed'
    await db.collection('loop_engine_runs').doc(runId).set({
      id: runId,
      loopId: 'agent-task-dispatch',
      loopName: 'Agent Task Dispatch',
      orgId: input.taskData.orgId ?? '',
      projectId: input.taskData.projectId ?? null,
      status,
      dryRun: false,
      riskLevel: input.taskData.riskLevel ?? 'medium',
      ownerAgentId: input.agentId,
      reviewerAgentId: input.taskData.reviewerAgentId ?? 'qa-release',
      trigger: { kind: 'task', ref: input.taskRef.id, source: 'agent-watcher' },
      candidateSummary: `Agent watcher dispatched task ${input.taskRef.id} to ${input.agentId}.`,
      candidates: [{
        id: input.taskRef.id,
        type: 'task',
        title: input.taskData.title ?? input.taskRef.id,
        orgId: input.taskData.orgId ?? null,
        projectId: input.taskData.projectId ?? null,
        taskId: input.taskRef.id,
      }],
      readinessResults: [],
      proposedActions: [],
      executedActions: [],
      approvalGates: [],
      evidence: [{
        type: 'source',
        label: 'Task',
        ref: input.taskRef.id,
        summary: input.taskData.title ?? input.taskRef.id,
      }],
      observability: {
        lastMeaningfulAction: input.error ? `Hermes run failed: ${input.error}` : 'Hermes run completed and returned output.',
        noOpStreak: input.error ? 1 : 0,
        verificationFailures: input.error ? [input.error] : [],
        budgetStatus: 'within-budget',
        needsHumanJudgment: !input.telemetry.exactUsageAvailable,
        progressSignal: input.error ? 'blocked' : 'advanced',
      },
      usage: input.telemetry,
      runtime: {
        source: 'agent-watcher',
        taskId: input.taskRef.id,
        agentId: input.agentId,
        runId: input.runId,
        provider: input.telemetry.provider,
        model: input.telemetry.model,
        reasoningEffort: input.telemetry.reasoningEffort,
        requiresExactModelTelemetry: true,
        exactTokenUsageAvailable: input.telemetry.exactTokenUsageAvailable,
        exactCostAvailable: input.telemetry.exactCostAvailable,
        exactUsageAvailable: input.telemetry.exactUsageAvailable,
      },
      telemetry: {
        ...input.telemetry,
        source: 'agent-watcher',
        requiresExactModelTelemetry: true,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'agent-watcher',
      updatedByType: 'system',
    }, { merge: true })
  } catch (err) {
    logger.warn('failed to persist agent dispatch loop-run telemetry', {
      taskId: input.taskRef.id,
      agentId: input.agentId,
      runId: input.runId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function deferTask(agentId: AgentId, taskRef: DocumentReference, taskData: TaskData): void {
  const existing = deferredByAgent.get(agentId) ?? new Map<string, { ref: DocumentReference; data: TaskData }>()
  existing.set(taskRef.path, { ref: taskRef, data: taskData })
  deferredByAgent.set(agentId, existing)
  logger.info('task deferred — agent concurrency limit reached', { taskId: taskRef.id, agentId })
}

function drainDeferredTasks(agentId: AgentId): void {
  const queued = deferredByAgent.get(agentId)
  if (!queued || queued.size === 0) return

  while ((perAgentInFlight.get(agentId) ?? 0) < MAX_CONCURRENT_PER_AGENT && queued.size > 0) {
    const next = queued.entries().next().value as [string, { ref: DocumentReference; data: TaskData }] | undefined
    if (!next) break
    const [path, item] = next
    queued.delete(path)
    void dispatchTask(item.ref, item.data)
  }

  if (queued.size === 0) deferredByAgent.delete(agentId)
}

async function dependenciesResolved(
  taskRef: DocumentReference,
  deps: string[] | undefined,
  approvalGateTaskId?: string,
): Promise<{ ok: boolean; blockers: string[] }> {
  const dependencyGateIds = getTaskDependencyGateIds(deps, approvalGateTaskId)
  if (dependencyGateIds.length === 0) return { ok: true, blockers: [] }
  const dependenciesById: Record<string, DependencyState | null> = {}
  for (const dep of dependencyGateIds) {
    try {
      // Dependencies normally live beside the task in the same project's tasks subcollection.
      // Do not use collectionGroup + FieldPath.documentId() with bare IDs: Firestore rejects
      // those queries for collection groups because __name__ must be a valid relative path.
      const depSnap = await taskRef.parent.doc(dep).get()
      if (!depSnap.exists) {
        dependenciesById[dep] = null
        continue
      }
      dependenciesById[dep] = depSnap.data() as DependencyState
    } catch (err) {
      logger.warn('dependency lookup failed', {
        taskId: taskRef.id,
        dependencyId: dep,
        error: err instanceof Error ? err.message : String(err),
      })
      dependenciesById[dep] = null
    }
  }
  const blockers = getUnresolvedTaskDependencyGateIds(deps, approvalGateTaskId, dependenciesById)
  return { ok: blockers.length === 0, blockers }
}

type TaskComment = {
  text?: string
  userName?: string
  userRole?: string
  createdAt?: { toDate?: () => Date; seconds?: number; _seconds?: number } | string | null
}

function commentDate(value: TaskComment['createdAt']): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toDate === 'function') {
    try { return value.toDate().toISOString() } catch { return '' }
  }
  const seconds = value.seconds ?? value._seconds
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : ''
}

function formatTaskComments(comments: TaskComment[]): string {
  if (comments.length === 0) return ''
  return comments
    .map((comment) => {
      const author = comment.userName || comment.userRole || 'comment'
      const date = commentDate(comment.createdAt)
      return `- ${date ? `${date} ` : ''}${author}: ${comment.text ?? ''}`
    })
    .join('\n')
}

function truncatePromptText(value: string, max = 1_600): string {
  const clean = value.trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max - 1).trimEnd()}…`
}

function buildCeoDataDecisionOperatingRule(orgId: string): string {
  return buildSharedCeoDataDecisionOperatingRule({
    orgId,
    heading: 'CEO data-decision operating rule:',
    bulletPrefix: '- ',
  })
}

function buildCompletionIntegrityHandoff(): string {
  return [
    'Completion-integrity control (mandatory):',
    '- Do not set agentStatus=done, columnId=done, reviewStatus=approved, or claim final completion from narrative alone.',
    '- Before ending, PATCH this task with completionEvidence { schemaVersion: 1, workKind: code|no-code, changedFiles, testCommand, testResult: passed, worktreeState, and for code commitSha; no-code requires noCodeReason and no changed files }.',
    '- Code work requires a clean worktree and a commit that the watcher can verify as reachable from origin/development. The watcher records the verifier identity/result and performs the final handoff.',
    '- If any work is unresolved, say so plainly and leave the task blocked; do not manufacture completion evidence.',
  ].join('\n')
}

/** Durable task handoff metadata for the next agent (not only runtime injection). */
function buildDurableTaskHandoffBlock(taskData: TaskData): string {
  const lines: string[] = ['Task handoff (durable):']
  if (taskData.projectId?.trim()) lines.push(`- projectId: ${taskData.projectId.trim()}`)
  if (taskData.orgId?.trim()) lines.push(`- orgId: ${taskData.orgId.trim()}`)
  if (Array.isArray(taskData.dependsOn) && taskData.dependsOn.length > 0) {
    lines.push(`- dependsOn: ${taskData.dependsOn.filter(Boolean).join(', ')}`)
  }
  if (taskData.approvalGateTaskId?.trim()) lines.push(`- approvalGateTaskId: ${taskData.approvalGateTaskId.trim()}`)
  if (taskData.reviewerAgentId?.trim()) lines.push(`- reviewerAgentId: ${taskData.reviewerAgentId.trim()}`)
  if (taskData.riskLevel?.trim()) lines.push(`- riskLevel: ${taskData.riskLevel.trim()}`)
  if (taskData.requiredCapability?.trim()) lines.push(`- requiredCapability: ${taskData.requiredCapability.trim()}`)
  if (taskData.sourceDocumentId?.trim()) lines.push(`- sourceDocumentId: ${taskData.sourceDocumentId.trim()}`)
  if (taskData.sourceDocumentSectionId?.trim()) lines.push(`- sourceDocumentSectionId: ${taskData.sourceDocumentSectionId.trim()}`)
  if (taskData.sourceSpecVersion?.trim()) lines.push(`- sourceSpecVersion: ${taskData.sourceSpecVersion.trim()}`)
  if (taskData.sourceResearchItemId?.trim()) lines.push(`- sourceResearchItemId: ${taskData.sourceResearchItemId.trim()}`)
  if (Array.isArray(taskData.expectedArtifacts) && taskData.expectedArtifacts.length > 0) {
    lines.push(`- expectedArtifacts: ${taskData.expectedArtifacts.join(' | ')}`)
  }
  if (Array.isArray(taskData.verifierChecklist) && taskData.verifierChecklist.length > 0) {
    lines.push(`- verifierChecklist: ${taskData.verifierChecklist.join(' | ')}`)
  }
  if (taskData.chatOrigin?.conversationId?.trim()) {
    lines.push(`- chatOrigin.conversationId: ${taskData.chatOrigin.conversationId.trim()}`)
  }
  // Only the header means nothing durable was present.
  return lines.length > 1 ? lines.join('\n') : ''
}

async function buildProjectDispatchContext(
  taskRef: DocumentReference,
  taskData: TaskData,
): Promise<string> {
  const projectId = taskData.projectId?.trim()
  if (!projectId) return ''

  const lines: string[] = []
  try {
    const projectDoc = await db.collection('projects').doc(projectId).get()
    const project = projectDoc.exists ? projectDoc.data() as Record<string, unknown> | undefined : undefined
    lines.push('Project context:')
    lines.push(`- projectId: ${projectId}`)
    if (typeof project?.name === 'string' && project.name.trim()) lines.push(`- name: ${project.name.trim()}`)
    if (typeof project?.status === 'string' && project.status.trim()) lines.push(`- status: ${project.status.trim()}`)
    const surfaceModeBlock = buildSurfaceModePromptBlock(project?.surfaceMode)
    if (surfaceModeBlock) lines.push(surfaceModeBlock)
  } catch (err) {
    logger.warn('failed to load project dispatch context', {
      taskId: taskRef.id,
      projectId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  if (lines.length === 0) return ''
  lines.push(`Before starting, fetch the task-scoped source of truth from GET /api/v1/agent/project/${projectId}/task/${taskRef.id}/context. It contains this task contract, approved source references, dependency evidence, and recent task comments; do not load parent chat history or unrelated project work.`)
  return lines.join('\n')
}

async function loadRecentTaskComments(taskRef: DocumentReference, limit = 8): Promise<TaskComment[]> {
  const maybeCollection = (taskRef as unknown as { collection?: (name: string) => unknown }).collection
  if (typeof maybeCollection !== 'function') return []
  try {
    const collection = maybeCollection.call(taskRef, 'comments') as {
      orderBy: (field: string, direction: 'asc' | 'desc') => { limit: (n: number) => { get: () => Promise<{ docs: Array<{ data: () => TaskComment }> }> } }
    }
    const snap = await collection.orderBy('createdAt', 'desc').limit(limit).get()
    return snap.docs.map((doc) => doc.data()).reverse().filter((comment) => typeof comment.text === 'string' && comment.text.trim().length > 0)
  } catch (err) {
    logger.warn('failed to load task comments for dispatch prompt', {
      taskId: taskRef.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

export async function dispatchTask(taskRef: DocumentReference, taskData: TaskData): Promise<void> {
  const taskId = taskRef.id
  const agentId = taskData.assigneeAgentId as AgentId | undefined
  const blocker = getTaskDispatchBlocker(taskData, currentAgentIds())
  if (blocker) return
  if (!isActiveAgentId(agentId)) return

  if (inFlight.has(taskRef.path)) return
  if ((perAgentInFlight.get(agentId) ?? 0) >= MAX_CONCURRENT_PER_AGENT) {
    deferTask(agentId, taskRef, taskData)
    return
  }

  // Dependency gating
  const deps = await dependenciesResolved(taskRef, taskData.dependsOn, taskData.approvalGateTaskId)
  if (!deps.ok) {
    logger.info('task deferred — dependencies not resolved', {
      taskId,
      agentId,
      blockers: deps.blockers,
    })
    return
  }

  inFlight.add(taskRef.path)
  incAgent(agentId)
  let stopHeartbeat: (() => void) | null = null
  let activeRunId: string | null = null

  try {
    // Transactional claim
    const claimed = await claimTask(taskRef, agentId)
    if (!claimed) {
      logger.info('claim lost (another watcher or status changed)', { taskId, agentId })
      return
    }

    // Load agent config / linked-computer target
    const credentialOwnerUid = taskData.llmCredentialOwnerUid || taskData.createdBy || taskData.reporterId || ''

    // Pairing rule: never force a provider without an explicit model.
    // Stamping agentProvider=openai-codex with agentModel=null makes Hermes keep the
    // profile default model (grok-4.5) on ChatGPT Codex → HTTP 400.
    // Prefer profile primary (xai-oauth/grok-4.5) when the card only has a provider stamp.
    //
    // Model allowlist boundary: the canonical model catalogue lives in the web app
    // (lib/llm-providers/model-registry.ts) and is enforced at task create/update +
    // workflow-graph authoring. This daemon is a separate CommonJS service with no
    // user-delegation context and cannot import that module, so it intentionally does
    // NOT keep a second copied model allowlist. Dispatch trusts the persisted card and
    // Hermes api_server's own _DEFAULT_RUN_MODEL_ALLOWLIST (patched by
    // infra/hermes/patch_llm_model_allowlist.py) rejects unsupported models fail-closed
    // as a run error, which this daemon surfaces as task failure/retry.
    // Dependency contract: extract a shared TS package (e.g. packages/model-catalogue)
    // that both the web app and this watcher import, then re-enable app-side validation
    // here. Do not partially duplicate the allowlist in this service first.
    const taskModel = taskData.agentModel?.trim() || null
    const taskProvider = taskData.agentProvider?.trim() || null
    const safeTaskProvider = taskModel ? taskProvider : null
    if (taskProvider && !taskModel) {
      logger.warn('ignoring provider-only task stamp so Hermes profile primary can run', {
        taskId,
        agentId,
        ignoredProvider: taskProvider,
      })
    }

    let linkedTarget: LinkedDeviceDispatchTarget | null = null
    try {
      linkedTarget = await resolveLinkedComputerDispatchTarget({
        runtimeTargetId: taskData.agentRuntimeTargetId,
        orgId: taskData.orgId ?? '',
        ownerUid: credentialOwnerUid,
        agentId,
        projectId: taskData.projectId ?? null,
      })
    } catch (linkedResolveErr) {
      const message = linkedResolveErr instanceof Error ? linkedResolveErr.message : String(linkedResolveErr)
      // Offline/stale Mac pins must not silently fall back to VPS.
      if (String(taskData.agentRuntimeTargetId || '').startsWith('linked-device:')) {
        logger.warn('linked-device pin is not dispatchable — marking blocked/retryable', {
          taskId,
          agentId,
          runtimeTargetId: taskData.agentRuntimeTargetId,
          error: message,
        })
        if (isTransientHermesError(message) || /offline|stale|heartbeat|retry/i.test(message)) {
          const priorRetryCount = Number.isFinite(taskData.agentRetryCount) ? Math.max(0, Number(taskData.agentRetryCount)) : 0
          if (priorRetryCount < MAX_TRANSIENT_RETRIES) {
            const nextRetryCount = priorRetryCount + 1
            const retryAt = transientRetryAt(priorRetryCount, Date.now(), message)
            await taskRef.update({
              ...agentStatusUpdate('pending'),
              agentRetryCount: nextRetryCount,
              agentRetryAt: retryAt,
              agentHeartbeatAt: FieldValue.delete(),
              agentRuntimeTargetId: taskData.agentRuntimeTargetId,
              agentOutput: {
                summary: `Transient watcher error: ${message} Automatic retry ${nextRetryCount}/${MAX_TRANSIENT_RETRIES} scheduled for ${retryAt}.`,
                completedAt: FieldValue.serverTimestamp(),
              },
              updatedAt: FieldValue.serverTimestamp(),
            })
            return
          }
        }
        await taskRef.update({
          ...agentStatusUpdate('blocked'),
          agentRuntimeTargetId: taskData.agentRuntimeTargetId,
          agentOutput: {
            summary: `Watcher error: ${message}`,
            completedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        })
        notifyCommandSessionFromTask(taskRef, taskData as unknown as Record<string, unknown>, 'blocked', {
          agentId,
          summary: `Watcher error: ${message}`,
          blockingReason: message,
        })
        return
      }
      logger.warn('linked-device resolve skipped; continuing VPS path', {
        taskId,
        agentId,
        error: message,
      })
      linkedTarget = null
    }

    const requestedRuntimeTarget = linkedTarget
      ? null
      : await resolveWatcherRuntimePreference({
        runtimeTargetId: taskData.agentRuntimeTargetId,
        orgId: taskData.orgId ?? '',
        ownerUid: credentialOwnerUid,
        agentId,
        resolvedSource: taskData.llmResolvedSource,
      })

    const cfg = linkedTarget ? null : await getAgentConfig(agentId, requestedRuntimeTarget)
    if (!linkedTarget && (!cfg || !cfg.enabled)) {
      logger.warn('agent has no enabled dispatch config — marking task blocked', { taskId, agentId })
      const blockedSummary = `Watcher error: agent '${agentId}' has no enabled dispatch config in agent_dispatch_configs.`
      await taskRef.update({
        ...agentStatusUpdate('blocked'),
        agentOutput: {
          summary: blockedSummary,
          completedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      })
      notifyCommandSessionFromTask(taskRef, taskData as unknown as Record<string, unknown>, 'blocked', {
        agentId,
        summary: blockedSummary,
        blockingReason: blockedSummary,
      })
      void notifyWorkflowGraphTerminal({
        taskRef,
        taskId,
        taskData: {
          ...(taskData as unknown as Record<string, unknown>),
          agentOutput: { summary: blockedSummary },
        },
        outcome: 'blocked',
        summary: blockedSummary,
        errorFamily: 'unknown',
        actorUid: agentId,
      })
      return
    }

    let credentialRoute: Awaited<ReturnType<typeof resolveWatcherLlmRoute>> = null
    if (!linkedTarget) {
      try {
        credentialRoute = await resolveWatcherLlmRoute({
          orgId: taskData.orgId ?? '',
          ownerUid: credentialOwnerUid,
          agentId,
          provider: safeTaskProvider,
          connectionId: taskModel ? (taskData.llmConnectionId ?? null) : null,
          runtimeTargetId: taskData.agentRuntimeTargetId || cfg?.targetId || requestedRuntimeTarget || 'vps',
        })
      } catch (routeErr) {
        // Soft-fallback: profile auth already holds SuperGrok/Codex tokens. Do not block the
        // whole Kanban chain when a Firestore binding is mid-sync / not live-ready yet.
        logger.warn('LLM credential route unavailable; dispatching with profile defaults', {
          taskId,
          agentId,
          provider: safeTaskProvider,
          error: routeErr instanceof Error ? routeErr.message : String(routeErr),
        })
        credentialRoute = null
      }
    }

    // The same task retry counter must resolve to the same opaque key after a
    // watcher crash. A new durable retry increments that counter only after
    // reconciliation proves this attempt was not accepted.
    const dispatchAttempt = Number.isFinite(taskData.agentRetryCount)
      ? Math.max(0, Math.trunc(Number(taskData.agentRetryCount)))
      : 0
    const dispatchKey = stableTaskDispatchKey({
      orgId: taskData.orgId ?? '',
      taskId,
      agentId,
      attempt: dispatchAttempt,
    })

    // Move to in-progress + start heartbeat. Always preserve an explicit linked-device pin.
    await taskRef.update({
      ...agentStatusUpdate('in-progress'),
      agentDispatchKey: dispatchKey,
      agentHeartbeatAt: FieldValue.serverTimestamp(),
      ...(taskData.agentRuntimeTargetId
        ? { agentRuntimeTargetId: taskData.agentRuntimeTargetId }
        : credentialRoute
          ? { agentRuntimeTargetId: credentialRoute.runtimeTargetId }
          : {}),
      ...(linkedTarget
        ? {
            agentDispatchRuntimeKind: 'linked-computer',
            agentLinkedDeviceId: linkedTarget.deviceId,
            agentLinkedDeviceLabel: linkedTarget.machineLabel,
          }
        : {}),
      ...(credentialRoute ? {
        llmConnectionId: credentialRoute.connectionId,
        llmCredentialBindingId: credentialRoute.credentialBindingId,
        llmResolvedSource: credentialRoute.resolvedSource,
      } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    })
    notifyCommandSessionFromTask(taskRef, taskData as unknown as Record<string, unknown>, 'in-progress', {
      agentId,
      summary: linkedTarget
        ? `Agent claimed the task for linked computer ${linkedTarget.machineLabel}.`
        : 'Agent claimed the task and started work.',
    })
    stopHeartbeat = startHeartbeat(taskRef)

    const baseSpec = taskData.agentInput?.spec?.trim() || taskData.title || `Task ${taskId}`
    const commentBlock = formatTaskComments(await loadRecentTaskComments(taskRef))
    const projectContextBlock = await buildProjectDispatchContext(taskRef, taskData)
    const designContextBlock = await buildDesignContextPromptBlock(taskData.orgId)
    const durableHandoffBlock = buildDurableTaskHandoffBlock(taskData)
    const linkedHostBlock = linkedTarget
      ? [
          '## Linked computer dispatch',
          `You are running on linked computer **${linkedTarget.machineLabel}** (${linkedTarget.runtimeTargetId}).`,
          `Platform: ${linkedTarget.platform || 'unknown'}; runtime ${linkedTarget.runtimeVersion || 'unknown'}.`,
          linkedTarget.workingDirectory
            ? ('Working directory hint: `' + linkedTarget.workingDirectory + '`.')
            : 'Use the device workspace mapping root unless the task specifies another path.',
          'Do not invent missing repos on the VPS. Prefer the machine-local Cowork/product roots.',
          'In agentOutput, identify this host (machine label), not hermes-vps-01.',
        ].join('\n')
      : ''
    const promptAssembly = buildWatcherPromptBudget([
      { id: 'task_spec', content: baseSpec, priority: 'critical' },
      { id: 'completion_integrity', content: buildCompletionIntegrityHandoff(), priority: 'critical' },
      { id: 'durable_task_handoff', content: durableHandoffBlock, priority: 'high' },
      { id: 'project_identity', content: projectContextBlock, priority: 'high' },
      { id: 'recent_task_comments', content: commentBlock ? `Recent task comments / revision notes:\n${commentBlock}` : '', priority: 'high' },
      { id: 'ceo_decision_rule', content: buildCeoDataDecisionOperatingRule(taskData.orgId ?? ''), priority: 'normal' },
      { id: 'linked_host', content: linkedHostBlock, priority: 'normal' },
      { id: 'design_context', content: designContextBlock, priority: 'optional' },
    ])
    const spec = promptAssembly.content
    await taskRef.update({
      promptProfile: 'task_execution',
      contextLedger: promptAssembly.ledger,
      updatedAt: FieldValue.serverTimestamp(),
    })
    const dispatchInput: TaskDispatchInput = {
      taskId,
      dispatchKey,
      orgId: taskData.orgId ?? '',
      agentId,
      spec,
      context: {
        ...(taskData.agentInput?.context ?? {}),
        ...(taskData.projectId ? { projectId: taskData.projectId } : {}),
        ...(taskData.orgId ? { orgId: taskData.orgId } : {}),
        ...(taskData.reviewerAgentId ? { reviewerAgentId: taskData.reviewerAgentId } : {}),
        ...(taskData.riskLevel ? { riskLevel: taskData.riskLevel } : {}),
        ...(taskData.requiredCapability ? { requiredCapability: taskData.requiredCapability } : {}),
        ...(taskData.requestedByAgentId ? { requestedByAgentId: taskData.requestedByAgentId } : {}),
        ...(taskData.approvalGateTaskId ? { approvalGateTaskId: taskData.approvalGateTaskId } : {}),
        ...(taskData.sourceDocumentId ? { sourceDocumentId: taskData.sourceDocumentId } : {}),
        ...(taskData.sourceDocumentSectionId ? { sourceDocumentSectionId: taskData.sourceDocumentSectionId } : {}),
        ...(taskData.sourceSpecVersion ? { sourceSpecVersion: taskData.sourceSpecVersion } : {}),
        ...(taskData.sourceResearchItemId ? { sourceResearchItemId: taskData.sourceResearchItemId } : {}),
        ...(Array.isArray(taskData.expectedArtifacts) ? { expectedArtifacts: taskData.expectedArtifacts } : {}),
        ...(Array.isArray(taskData.verifierChecklist) ? { verifierChecklist: taskData.verifierChecklist } : {}),
        ...(Array.isArray(taskData.dependsOn) && taskData.dependsOn.length > 0 ? { dependsOn: taskData.dependsOn } : {}),
        ...(linkedTarget
          ? {
              linkedDeviceId: linkedTarget.deviceId,
              linkedDeviceLabel: linkedTarget.machineLabel,
              dispatchRuntimeKind: 'linked-computer',
            }
          : {}),
      },
      constraints: taskData.agentInput?.constraints,
      agentEffort: taskData.agentEffort ?? null,
      agentModel: taskModel,
      // Only pass provider when it came from a verified route or an explicit model+provider pair.
      // Linked Mac runs keep explicit model+provider pairs (e.g. grok-4.5/xai-oauth); provider-only stamps stay null.
      agentProvider: credentialRoute?.provider ?? (taskModel ? taskProvider : null),
      llmCredentialSource: taskData.llmCredentialSource ?? null,
      llmResolvedSource: credentialRoute?.resolvedSource ?? taskData.llmResolvedSource ?? null,
      llmConnectionId: credentialRoute?.connectionId ?? (taskModel ? taskData.llmConnectionId ?? null : null),
      llmCredentialBindingId: credentialRoute?.credentialBindingId ?? (taskModel ? taskData.llmCredentialBindingId ?? null : null),
      runtimeTargetId: linkedTarget?.runtimeTargetId
        ?? credentialRoute?.runtimeTargetId
        ?? taskData.agentRuntimeTargetId
        ?? cfg?.targetId
        ?? null,
    }

    // Callback: fires as soon as Hermes accepts a run and MUST persist the id
    // before polling. Throwing deliberately stops pollRun; the accepted key/id
    // remains recoverable rather than being hidden behind a polling storm.
    const onRunCreated = async (runId: string): Promise<void> => {
      activeRunId = runId
      await taskRef.update({
        agentConversationId: runId,
        agentDispatchKey: dispatchKey,
        updatedAt: FieldValue.serverTimestamp(),
      })
      logger.info('persisted accepted Hermes run before polling', { taskId, agentId, runId, dispatchKey })
    }

    let result: Awaited<ReturnType<typeof runAndPoll>>
    let effectiveDispatchInput = dispatchInput
    let effectiveCfg = cfg
    // VPS-dispatched Kanban tasks that may mutate a repository are isolated
    // in a task-scoped Git worktree before Hermes is called. Linked-computer
    // jobs are isolated by the runtime worker instead, so this only runs
    // when there is no linked target and the watcher dispatches directly.
    let watcherWorktree: WatcherWorktreeResult | null = null
    if (!linkedTarget && taskData.projectId) {
      const repoRoot = process.env.PIB_REPO_ROOT || process.cwd()
      try {
        watcherWorktree = await prepareWatcherTaskWorktree({
          taskId,
          repositoryRoot: repoRoot,
        })
      } catch (worktreeErr) {
        logger.warn('watcher worktree preflight threw — leaving task blocked', {
          taskId,
          agentId,
          error: worktreeErr instanceof Error ? worktreeErr.message : String(worktreeErr),
        })
        watcherWorktree = {
          ok: false,
          taskId,
          code: 'task_worktree_conflict',
          message: worktreeErr instanceof Error ? worktreeErr.message : String(worktreeErr),
        }
      }
      if (watcherWorktree && !watcherWorktree.ok) {
        const blockedSummary = `TASK_WORKTREE_BLOCKED:${watcherWorktree.code}: ${watcherWorktree.message}`
        logger.warn('watcher worktree preflight blocked — marking task blocked', {
          taskId,
          agentId,
          code: watcherWorktree.code,
        })
        await taskRef.update({
          ...agentStatusUpdate('blocked'),
          agentHeartbeatAt: FieldValue.delete(),
          agentOutput: {
            summary: blockedSummary,
            completedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        })
        notifyCommandSessionFromTask(taskRef, taskData as unknown as Record<string, unknown>, 'blocked', {
          agentId,
          summary: blockedSummary,
          blockingReason: watcherWorktree.message,
        })
        return
      }
      if (watcherWorktree?.ok) {
        effectiveDispatchInput = { ...dispatchInput, workingDirectory: watcherWorktree.workingDirectory }
        logger.info('watcher isolated task worktree created for VPS dispatch', {
          taskId,
          agentId,
          branch: watcherWorktree.branch,
          workingDirectory: watcherWorktree.workingDirectory,
          reused: watcherWorktree.reused,
        })
      }
    }
    if (linkedTarget) {
      logger.info('dispatching task to linked computer queue', {
        taskId,
        agentId,
        orgId: dispatchInput.orgId,
        deviceId: linkedTarget.deviceId,
        machineLabel: linkedTarget.machineLabel,
        runtimeTargetId: linkedTarget.runtimeTargetId,
      })
      result = await runKanbanLinkedAndPoll({
        target: linkedTarget,
        taskId,
        taskPath: taskRef.path,
        agentId,
        projectId: taskData.projectId ?? null,
        payload: {
          prompt: `[Task ${taskId}] ${spec}`,
          ...(taskModel ? { model: taskModel } : {}),
          ...(dispatchInput.agentProvider ? { provider: dispatchInput.agentProvider } : {}),
          yolo: true,
        },
        onRunCreated,
      })
    } else {
      logger.info('dispatching task to Hermes', { taskId, agentId, orgId: dispatchInput.orgId })
      result = await runAndPoll(cfg!, dispatchInput, onRunCreated)
      // The VPS gateway may be unavailable while a fresh local runtime is healthy.
      // This is a same-dispatch transport recovery, not a retry of accepted agent work.
      if (canFailOverPreExecutionDispatch({ taskData, cfg, linkedTarget, credentialRoute, result })) {
        const localCfg = await getAgentConfig(agentId, 'local')
        if (localCfg?.enabled && localCfg.targetId === 'local' && localCfg.baseUrl !== cfg?.baseUrl) {
          effectiveDispatchInput = { ...dispatchInput, runtimeTargetId: localCfg.targetId }
          logger.warn('VPS Hermes pre-execution failure; attempting safe local failover', {
            taskId,
            agentId,
            failedTarget: cfg?.targetId,
            fallbackTarget: localCfg.targetId,
            error: result.error,
          })
          effectiveCfg = localCfg
          result = await runAndPoll(localCfg, effectiveDispatchInput, onRunCreated)
        }
      }
    }
    activeRunId = result.runId ?? activeRunId
    const telemetry = result.telemetry ?? fallbackTelemetry(effectiveDispatchInput)
    stopHeartbeat?.()
    stopHeartbeat = null
    await persistAgentDispatchRun({
      taskRef,
      taskData,
      agentId,
      runId: activeRunId,
      telemetry,
      error: result.error,
    })

    if (result.error) {
      const priorRetryCount = Number.isFinite(taskData.agentRetryCount) ? Math.max(0, Number(taskData.agentRetryCount)) : 0
      const humanError = formatHermesWatcherError(result.error, {
        agentId,
        provider: credentialRoute?.provider ?? (taskModel ? taskProvider : null),
        model: taskModel,
      })
      const noRunId = !result.runId
      if (noRunId && result.dispatchAcceptance === 'unknown') {
        const dispatchFailure = {
          phase: 'dispatch-acceptance-unknown',
          targetId: effectiveCfg?.targetId ?? null,
          dispatchKey,
          error: humanError,
          retryEligible: false,
          observedAt: new Date().toISOString(),
        }
        const blockedSummary = `Watcher error: ${humanError} This task was not retried because dispatch acceptance is unknown; reconcile Idempotency-Key ${dispatchKey} before any new dispatch.`
        await taskRef.update({
          ...agentStatusUpdate('blocked'),
          agentHeartbeatAt: FieldValue.delete(),
          agentDispatchKey: dispatchKey,
          agentDispatchFailure: dispatchFailure,
          agentOutput: {
            summary: blockedSummary,
            telemetry,
            completedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        })
        notifyCommandSessionFromTask(taskRef, taskData as unknown as Record<string, unknown>, 'blocked', {
          agentId,
          summary: blockedSummary,
          blockingReason: humanError,
          runId: activeRunId,
        })
        return
      }
      if (result.runId && result.dispatchAcceptance === 'accepted') {
        const dispatchFailure = {
          phase: 'accepted-run-polling',
          targetId: effectiveCfg?.targetId ?? null,
          dispatchKey,
          error: humanError,
          retryEligible: false,
          observedAt: new Date().toISOString(),
        }
        const blockedSummary = `Watcher error after accepted run ${result.runId}: ${humanError} The watcher will not dispatch a second run; reconcile/poll the persisted run id instead.`
        await taskRef.update({
          ...agentStatusUpdate('blocked'),
          agentHeartbeatAt: FieldValue.delete(),
          agentConversationId: result.runId,
          agentDispatchKey: dispatchKey,
          agentDispatchFailure: dispatchFailure,
          agentOutput: {
            summary: blockedSummary,
            telemetry,
            completedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        })
        notifyCommandSessionFromTask(taskRef, taskData as unknown as Record<string, unknown>, 'blocked', {
          agentId,
          summary: blockedSummary,
          blockingReason: humanError,
          runId: result.runId,
        })
        return
      }
      const safePreExecutionRecovery = canRecoverPreExecutionDispatch({ taskData, result })
      const preExecutionFailure = isPreExecutionTransportFailure(result)
      const dispatchFailure = preExecutionFailure
        ? {
            phase: 'pre-execution',
            targetId: effectiveCfg?.targetId ?? null,
            dispatchKey,
            acceptance: result.dispatchAcceptance,
            error: humanError,
            retryEligible: safePreExecutionRecovery,
            observedAt: new Date().toISOString(),
          }
        : null
      if (preExecutionFailure && !safePreExecutionRecovery) {
        const blockedSummary = `Pre-execution dispatch did not start and was not retried because this task is approval-gated or side-effect-sensitive. Exact transport evidence: ${humanError}`
        await taskRef.update({
          ...agentStatusUpdate('blocked'),
          agentHeartbeatAt: FieldValue.delete(),
          agentDispatchFailure: dispatchFailure,
          agentOutput: {
            summary: blockedSummary,
            telemetry,
            completedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        })
        notifyCommandSessionFromTask(taskRef, taskData as unknown as Record<string, unknown>, 'blocked', {
          agentId,
          summary: blockedSummary,
          blockingReason: humanError,
          runId: activeRunId,
        })
        return
      }
      if ((preExecutionFailure ? safePreExecutionRecovery : isTransientHermesError(result.error)) && priorRetryCount < MAX_TRANSIENT_RETRIES) {
        const nextRetryCount = priorRetryCount + 1
        const retryAt = transientRetryAt(priorRetryCount, Date.now(), result.error)
        logger.warn('transient Hermes run failure — scheduling durable retry', {
          taskId,
          agentId,
          runId: activeRunId,
          retryCount: nextRetryCount,
          retryAt,
          error: result.error,
        })
        await taskRef.update({
          ...agentStatusUpdate('pending'),
          ...(activeRunId ? { agentConversationId: activeRunId } : {}),
          agentDispatchKey: FieldValue.delete(),
          agentRetryCount: nextRetryCount,
          agentRetryAt: retryAt,
          agentHeartbeatAt: FieldValue.delete(),
          ...(dispatchFailure ? { agentDispatchFailure: dispatchFailure } : {}),
          agentOutput: {
            summary: `Transient watcher error: ${humanError} Automatic retry ${nextRetryCount}/${MAX_TRANSIENT_RETRIES} scheduled for ${retryAt}.`,
            telemetry,
            completedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        })
        return
      }
      logger.warn('Hermes run failed — marking blocked', { taskId, agentId, error: result.error })
      await taskRef.update({
        ...agentStatusUpdate('blocked'),
        ...(activeRunId ? { agentConversationId: activeRunId } : {}),
        agentOutput: {
          summary: `Watcher error: ${humanError}`,
          telemetry,
          completedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      })
      notifyCommandSessionFromTask(taskRef, taskData as unknown as Record<string, unknown>, 'blocked', {
        agentId,
        summary: `Watcher error: ${humanError}`,
        blockingReason: humanError,
        runId: activeRunId,
      })
      void notifyWorkflowGraphTerminal({
        taskRef,
        taskId,
        taskData: {
          ...(taskData as unknown as Record<string, unknown>),
          agentOutput: { summary: `Watcher error: ${humanError}`, telemetry },
        },
        outcome: 'blocked',
        summary: `Watcher error: ${humanError}`,
        hermesRunId: activeRunId,
        telemetry,
        errorFamily: isTransientHermesError(result.error) ? 'transient_infra' : 'unknown',
        actorUid: agentId,
      })
      return
    }

    const summary = (result.output ?? '').slice(0, 4_000) || 'Hermes returned no output.'
    if (outputNeedsHumanInput(summary)) {
      const blockingReason = extractBlockingReason(summary)
      const requiredEvidence = extractRequiredEvidence(summary)
      const messageForAgent = extractMessageForAgent(summary)
      const safeContinuePath = 'Add the required approval/input evidence or comment in the linked task, then use the safe continue/unblock action. Do not bypass approval gates: production deploys, client-visible sends/publishing, paid spend, finance, secrets/config, and destructive actions still require explicit approval evidence.'
      await taskRef.update({
        ...agentStatusUpdate('awaiting-input'),
        ...(activeRunId ? { agentConversationId: activeRunId } : {}),
        agentOutput: {
          summary,
          telemetry,
          needsPeet: true,
          blockingReason,
          requiredEvidence,
          messageForAgent,
          safeContinuePath,
          completedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      })
      await notifyNeedsPeet({
        taskId,
        taskData,
        agentId,
        blockingReason,
        requiredEvidence,
        messageForAgent,
        runId: activeRunId,
      })
      notifyCommandSessionFromTask(taskRef, taskData as unknown as Record<string, unknown>, 'awaiting-input', {
        agentId,
        summary,
        blockingReason,
        requiredEvidence,
        messageForAgent,
        runId: activeRunId,
      })
      void notifyWorkflowGraphTerminal({
        taskRef,
        taskId,
        taskData: {
          ...(taskData as unknown as Record<string, unknown>),
          agentOutput: { summary, telemetry, needsPeet: true, blockingReason, requiredEvidence, messageForAgent },
        },
        outcome: 'awaiting_input',
        summary,
        hermesRunId: activeRunId,
        telemetry,
        actorUid: agentId,
      })
      logger.info('task needs Peet input before continuing', { taskId, agentId, blockingReason })
      return
    }

    const completionSnap = await taskRef.get().catch(() => null)
    const completionTask = (completionSnap?.data() ?? taskData) as TaskData
    const completionFingerprint = completionStateFingerprint(completionTask)
    const completionEvidence = validateCompletionEvidence(completionTask.completionEvidence)
    const commitReachable = completionEvidence.ok && completionEvidence.evidence.workKind === 'code'
      ? await verifyReachableDevelopmentCommit(completionEvidence.evidence.commitSha!)
      : null
    const changedFilesMatch = completionEvidence.ok && completionEvidence.evidence.workKind === 'code'
      ? await verifyChangedFilesMatchCommit(completionEvidence.evidence.commitSha!, completionEvidence.evidence.changedFiles)
      : null
    const worktreeClean = completionEvidence.ok && completionEvidence.evidence.workKind === 'code'
      ? await verifyCleanWatcherWorktree()
      : null
    const completion = assessCompletionIntegrity({
      summary,
      evidence: completionTask.completionEvidence,
      commitReachable,
      changedFilesMatch,
      worktreeClean,
      currentAgentStatus: completionTask.agentStatus,
    })
    // Preserve producer-patched artifacts (merge live store). Never replace with
    // summary/telemetry-only — that thrash wiped Quinn dual-hold gold repeatedly.
    const doneAgentOutput = await buildMergedDoneAgentOutput({
      taskRef,
      taskData,
      summary,
      telemetry,
    })
    if (completion.outcome !== 'pass') {
      const exactReason = completion.reasons.join(', ')
      const blockedSummary = `${summary}\n\nCompletion integrity ${completion.outcome}: ${exactReason}.`
      await taskRef.update({
        ...agentStatusUpdate('blocked'),
        reviewStatus: 'changes-requested',
        ...(activeRunId ? { agentConversationId: activeRunId } : {}),
        agentHeartbeatAt: FieldValue.delete(),
        agentRetryCount: FieldValue.delete(),
        agentRetryAt: FieldValue.delete(),
        completionIntegrityFailureReasons: completion.reasons,
        completionVerification: {
          verifierIdentity: 'agent-watcher',
          verifierResult: 'failed',
          reasons: completion.reasons,
          commitReachable,
          changedFilesMatch,
          worktreeClean,
          verifiedAt: FieldValue.serverTimestamp(),
          verifierRunId: activeRunId,
        },
        agentOutput: { ...doneAgentOutput, summary: blockedSummary },
        updatedAt: FieldValue.serverTimestamp(),
      })
      notifyCommandSessionFromTask(taskRef, taskData as unknown as Record<string, unknown>, 'blocked', {
        agentId,
        summary: blockedSummary,
        blockingReason: exactReason,
        runId: activeRunId,
      })
      void notifyWorkflowGraphTerminal({
        taskRef,
        taskId,
        taskData: { ...(taskData as unknown as Record<string, unknown>), agentOutput: { ...doneAgentOutput, summary: blockedSummary } },
        outcome: 'blocked',
        summary: blockedSummary,
        hermesRunId: activeRunId,
        telemetry,
        errorFamily: completion.outcome === 'blocked' ? 'agent_incomplete' : 'verifier_fail',
        actorUid: agentId,
      })
      logger.warn('completion integrity rejected task completion', { taskId, agentId, reasons: completion.reasons })
      return
    }

    const finalized = await db.runTransaction(async (transaction) => {
      const latestSnap = await transaction.get(taskRef)
      const latestTask = (latestSnap.data() ?? completionTask) as TaskData
      if (completionStateFingerprint(latestTask) !== completionFingerprint) {
        transaction.update(taskRef, {
          completionIntegrityFailureReasons: ['completion_state_changed_during_verification'],
          completionVerification: {
            verifierIdentity: 'agent-watcher',
            verifierResult: 'failed',
            reasons: ['completion_state_changed_during_verification'],
            commitReachable,
            changedFilesMatch,
            worktreeClean,
            verifiedAt: FieldValue.serverTimestamp(),
            verifierRunId: activeRunId,
          },
          updatedAt: FieldValue.serverTimestamp(),
        })
        return { ok: false as const, hasReviewer: false }
      }
      const hasReviewer = taskHasAssignedReviewer(latestTask)
      transaction.update(taskRef, {
        ...agentStatusUpdate('done', { hasReviewer }),
        ...(activeRunId ? { agentConversationId: activeRunId } : {}),
        agentHeartbeatAt: FieldValue.delete(),
        agentRetryCount: FieldValue.delete(),
        agentRetryAt: FieldValue.delete(),
        completionEvidence: completion.evidence,
        completionIntegrityFailureReasons: FieldValue.delete(),
        completionVerification: {
          verifierIdentity: 'agent-watcher',
          verifierResult: 'passed',
          reasons: [],
          commitReachable,
          changedFilesMatch,
          worktreeClean,
          verifiedAt: FieldValue.serverTimestamp(),
          verifierRunId: activeRunId,
        },
        agentOutput: doneAgentOutput,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { ok: true as const, hasReviewer }
    })
    if (!finalized.ok) {
      logger.warn('completion integrity claim changed during verification', { taskId, agentId })
      return
    }
    const hasReviewer = finalized.hasReviewer
    notifyCommandSessionFromTask(taskRef, taskData as unknown as Record<string, unknown>, 'done', {
      agentId,
      summary,
      runId: activeRunId,
    })
    // With a reviewer, graph proven-done waits for reviewStatus=approved write-back.
    if (!hasReviewer) {
      void notifyWorkflowGraphTerminal({
        taskRef,
        taskId,
        taskData: {
          ...(taskData as unknown as Record<string, unknown>),
          agentOutput: doneAgentOutput,
        },
        outcome: 'done',
        summary,
        hermesRunId: activeRunId,
        telemetry,
        actorUid: agentId,
      })
    }
    logger.info('task completed', { taskId, agentId, hasReviewer })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const humanError = formatHermesWatcherError(message, {
      agentId,
      provider: taskData.agentProvider ?? null,
      model: taskData.agentModel ?? null,
    })
    logger.error('dispatchTask threw', { taskId, agentId, error: message })
    try {
      // Once a run id was observed, a retry would be a new execution unless a
      // future reconciler explicitly resumes that id. Preserve the evidence and
      // stop instead of turning a post-acceptance write/poll failure into a
      // second POST.
      if (activeRunId) {
        const blockedSummary = `Watcher error after accepted run ${activeRunId}: ${humanError} No new dispatch was scheduled; reconcile/poll the persisted run id instead.`
        await taskRef.update({
          ...agentStatusUpdate('blocked'),
          agentConversationId: activeRunId,
          agentHeartbeatAt: FieldValue.delete(),
          agentOutput: {
            summary: blockedSummary,
            completedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        })
        notifyCommandSessionFromTask(taskRef, taskData as unknown as Record<string, unknown>, 'blocked', {
          agentId,
          summary: blockedSummary,
          blockingReason: humanError,
          runId: activeRunId,
        })
        return
      }
      const priorRetryCount = Number.isFinite(taskData.agentRetryCount) ? Math.max(0, Number(taskData.agentRetryCount)) : 0
      if (isTransientHermesError(message) && priorRetryCount < MAX_TRANSIENT_RETRIES) {
        const nextRetryCount = priorRetryCount + 1
        const retryAt = transientRetryAt(priorRetryCount, Date.now(), message)
        await taskRef.update({
          ...agentStatusUpdate('pending'),
          ...(activeRunId ? { agentConversationId: activeRunId } : {}),
          agentRetryCount: nextRetryCount,
          agentRetryAt: retryAt,
          agentHeartbeatAt: FieldValue.delete(),
          agentOutput: {
            summary: `Transient watcher error: ${humanError} Automatic retry ${nextRetryCount}/${MAX_TRANSIENT_RETRIES} scheduled for ${retryAt}.`,
            completedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        })
        return
      }
      await taskRef.update({
        ...agentStatusUpdate('blocked'),
        ...(activeRunId ? { agentConversationId: activeRunId } : {}),
        agentOutput: {
          summary: `Watcher error: ${humanError}`,
          completedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      })
      notifyCommandSessionFromTask(taskRef, taskData as unknown as Record<string, unknown>, 'blocked', {
        agentId,
        summary: `Watcher error: ${humanError}`,
        blockingReason: humanError,
        runId: activeRunId,
      })
      void notifyWorkflowGraphTerminal({
        taskRef,
        taskId,
        taskData: {
          ...(taskData as unknown as Record<string, unknown>),
          agentOutput: { summary: `Watcher error: ${humanError}` },
        },
        outcome: 'blocked',
        summary: `Watcher error: ${humanError}`,
        hermesRunId: activeRunId,
        errorFamily: isTransientHermesError(message) ? 'transient_infra' : 'unknown',
        actorUid: agentId,
      })
    } catch (writeErr) {
      logger.error('failed to write blocked status after dispatch error', {
        taskId,
        error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      })
    }
  } finally {
    stopHeartbeat?.()
    inFlight.delete(taskRef.path)
    decAgent(agentId)
    drainDeferredTasks(agentId)
  }
}


async function addAgentReviewComment(taskRef: DocumentReference, agentId: AgentId, text: string): Promise<void> {
  await taskRef.collection('comments').add({
    text,
    userId: `agent:${agentId}`,
    userName: agentId.charAt(0).toUpperCase() + agentId.slice(1),
    userRole: 'ai',
    createdAt: FieldValue.serverTimestamp(),
    agentPickedUp: false,
    agentPickedUpAt: null,
  })
}

export function reviewFailed(output: string): boolean {
  return /^\s*(CHANGES[_ -]?REQUESTED|REJECTED|NOT[_ -]?APPROVED)\b/i.test(output)
}

export function reviewApproved(output: string): boolean {
  return /^\s*APPROVED\b/i.test(output) && !reviewFailed(output)
}

/**
 * Reviewer transport/auth failures must NOT requeue the implementer.
 * Only an explicit CHANGES_REQUESTED / REJECTED verdict moves the card back to todo.
 */
export async function dispatchReview(taskRef: DocumentReference, taskData: TaskData): Promise<void> {
  const taskId = taskRef.id
  const agentId = taskData.reviewerAgentId as AgentId | undefined
  if (!isActiveAgentId(agentId)) return
  if (taskData.columnId !== 'review' || taskData.reviewStatus !== 'pending') return
  // Claim requires agentStatus=done; skip while implementer is still running.
  if (taskData.agentStatus !== undefined && taskData.agentStatus !== 'done') return
  const reviewRetryAtMs = releaseMillis(taskData.reviewRetryAt)
  if (reviewRetryAtMs !== null && reviewRetryAtMs > Date.now()) {
    logger.info('review backoff active — skipping dispatch', { taskId, agentId, reviewRetryAtMs })
    return
  }
  if (inFlight.has(`${taskRef.path}:review`)) return
  if ((perAgentInFlight.get(agentId) ?? 0) >= MAX_CONCURRENT_PER_AGENT) return

  inFlight.add(`${taskRef.path}:review`)
  incAgent(agentId)
  try {
    const claimed = await claimReviewTask(taskRef, agentId)
    if (!claimed) {
      logger.info('review claim lost (another watcher or status changed)', { taskId, agentId })
      return
    }

    const cfg = await getAgentConfig(agentId)
    if (!cfg || !cfg.enabled) {
      await addAgentReviewComment(
        taskRef,
        agentId,
        `Review could not run: reviewer agent '${agentId}' has no enabled dispatch config. Leaving task in review (implementer not requeued).`,
      )
      // Stay in review — missing reviewer config is ops, not product CHANGES_REQUESTED.
      await taskRef.update({
        reviewStatus: 'pending',
        reviewRetryAt: transientRetryAt(0),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }
    // Fresh agentOutput (Quinn may have PATCHed artifacts after claim snapshot).
    const liveSnap = await taskRef.get().catch(() => null)
    const liveData = (liveSnap?.data() ?? taskData) as TaskData
    // Human already accepted while we were starting — do not thrash back to review/CR.
    if (liveData.reviewStatus === 'approved' || liveData.columnId === 'done') {
      logger.info('review skipped — human already approved', { taskId, agentId })
      return
    }
    // A reviewer only receives work whose implementer completion was independently
    // checked by the watcher. This blocks review from laundering a narrative into approval.
    if (liveData.completionVerification?.verifierResult !== 'passed') {
      const reason = 'completion_integrity_verification_required_before_reviewer_handoff'
      await taskRef.update({
        ...agentStatusUpdate('blocked'),
        reviewStatus: 'changes-requested',
        completionIntegrityFailureReasons: [reason],
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }
    const liveArtifacts = buildCompletionArtifacts({
      agentOutput: liveData.agentOutput,
      summary: liveData.agentOutput?.summary,
      expectedArtifacts: liveData.expectedArtifacts ?? taskData.expectedArtifacts,
    })
    // If store lost artifacts but expected stubs are recoverable, heal agentOutput before judging.
    if (
      liveArtifacts.length > 0
      && (!Array.isArray(liveData.agentOutput?.artifacts) || liveData.agentOutput.artifacts.length === 0)
    ) {
      const healed: Record<string, unknown> = {
        ...(liveData.agentOutput && typeof liveData.agentOutput === 'object' ? liveData.agentOutput : {}),
        artifacts: liveArtifacts,
      }
      for (const item of liveArtifacts) healed[item.type] = item.ref
      await taskRef.update({
        agentOutput: healed,
        updatedAt: FieldValue.serverTimestamp(),
      }).catch(() => undefined)
      liveData.agentOutput = healed as TaskData['agentOutput']
    }
    const spec = [
      `Review this completed task. Return APPROVED if it passes, or CHANGES_REQUESTED followed by clear feedback if it fails.`,
      `Task: ${taskData.title ?? taskId}`,
      liveData.agentOutput?.summary ? `Implementation summary:\n${liveData.agentOutput.summary}` : '',
      liveArtifacts.length > 0
        ? `Structured agentOutput.artifacts (authoritative store field):\n${JSON.stringify(liveArtifacts, null, 2)}`
        : 'Structured agentOutput.artifacts: (none in store — fail if expectedArtifacts required)',
      Array.isArray(liveData.expectedArtifacts) && liveData.expectedArtifacts.length > 0
        ? `expectedArtifacts: ${liveData.expectedArtifacts.join(' | ')}`
        : '',
      'If expectedArtifacts are present in structured artifacts (or typed top-level agentOutput keys), APPROVE. Do not CHANGES_REQUESTED solely because dual GET earlier in chat failed if live store now has artifacts.',
    ].filter(Boolean).join('\n\n')
    const result = await runAndPoll(cfg, {
      taskId,
      orgId: taskData.orgId ?? '',
      agentId,
      spec,
      context: { reviewTask: true, projectId: taskData.projectId ?? null },
      constraints: ['Be strict. If changes are needed, start with CHANGES_REQUESTED and explain exactly what to fix.'],
      agentEffort: 'medium',
    })
    const output = (result.error ? `Reviewer error: ${result.error}` : result.output ?? '').slice(0, 4_000)

    // Re-check human acceptance after long review run — never undo Peet accept.
    const postSnap = await taskRef.get().catch(() => null)
    const postData = (postSnap?.data() ?? {}) as TaskData
    if (postData.reviewStatus === 'approved' || postData.columnId === 'done') {
      await addAgentReviewComment(
        taskRef,
        agentId,
        `Reviewer finished after human already accepted. Leaving approved/done (no CR thrash).\n\nReviewer draft (not applied):\n${output.slice(0, 1500)}`,
      ).catch(() => undefined)
      logger.info('review result discarded — human already approved', { taskId, agentId })
      return
    }

    if (result.error) {
      const priorRetryCount = Number.isFinite(taskData.reviewRetryCount)
        ? Math.max(0, Number(taskData.reviewRetryCount))
        : 0
      const nextRetryCount = priorRetryCount + 1
      const retryAt = transientRetryAt(priorRetryCount, Date.now(), result.error)
      const transient = isTransientHermesError(result.error)
      await addAgentReviewComment(
        taskRef,
        agentId,
        transient
          ? `${output}\n\nTransient reviewer failure — implementer stays done in review. Automatic review retry ${nextRetryCount}/${MAX_TRANSIENT_RETRIES} at ${retryAt}.`
          : `${output}\n\nReviewer run failed without a product verdict. Implementer stays done in review (not requeued). Ops must fix reviewer runtime, then leave reviewStatus=pending.`,
      )
      await taskRef.update({
        // Keep board + implementer completion intact.
        columnId: 'review',
        agentStatus: 'done',
        reviewStatus: 'pending',
        reviewRetryCount: nextRetryCount,
        reviewRetryAt: retryAt,
        updatedAt: FieldValue.serverTimestamp(),
      })
      logger.warn('reviewer run error — not requeuing implementer', {
        taskId,
        agentId,
        transient,
        nextRetryCount,
        retryAt,
        error: result.error,
      })
      return
    }

    if (reviewFailed(output)) {
      await addAgentReviewComment(taskRef, agentId, output || 'CHANGES_REQUESTED: Review failed without details.')
      await taskRef.update({
        columnId: 'todo',
        agentStatus: 'pending',
        reviewStatus: 'changes-requested',
        reviewRetryCount: FieldValue.delete(),
        reviewRetryAt: FieldValue.delete(),
        agentHeartbeatAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      return
    }

    if (reviewApproved(output)) {
      await addAgentReviewComment(taskRef, agentId, output || 'APPROVED')
      await taskRef.update({
        columnId: 'done',
        reviewStatus: 'approved',
        completionVerification: {
          ...(liveData.completionVerification ?? {}),
          verifierIdentity: agentId,
          verifierResult: 'approved',
          reviewerHandoffFrom: 'agent-watcher',
          reviewerOutput: output || 'APPROVED',
          verifiedAt: FieldValue.serverTimestamp(),
        },
        reviewRetryCount: FieldValue.delete(),
        reviewRetryAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      // Fresh agentOutput for write-back (artifacts may have been healed mid-review).
      const approvedSnap = await taskRef.get().catch(() => null)
      const approvedData = (approvedSnap?.data() ?? liveData) as TaskData
      const writebackOutput = {
        ...(approvedData.agentOutput && typeof approvedData.agentOutput === 'object' ? approvedData.agentOutput : {}),
      } as Record<string, unknown>
      const approvedArtifacts = buildCompletionArtifacts({
        agentOutput: writebackOutput,
        summary: typeof writebackOutput.summary === 'string' ? writebackOutput.summary : liveData.agentOutput?.summary,
        expectedArtifacts: approvedData.expectedArtifacts ?? taskData.expectedArtifacts,
      })
      if (approvedArtifacts.length > 0) {
        writebackOutput.artifacts = approvedArtifacts
        for (const item of approvedArtifacts) writebackOutput[item.type] = item.ref
      }
      // Graph node proven-done when reviewer approves implementer output.
      void notifyWorkflowGraphTerminal({
        taskRef,
        taskId,
        taskData: {
          ...(approvedData as unknown as Record<string, unknown>),
          agentOutput: writebackOutput,
        },
        outcome: 'done',
        summary:
          typeof writebackOutput.summary === 'string'
            ? writebackOutput.summary
            : 'Review approved',
        hermesRunId: typeof approvedData.agentConversationId === 'string'
          ? approvedData.agentConversationId
          : typeof taskData.agentConversationId === 'string'
            ? taskData.agentConversationId
            : null,
        actorUid: agentId,
      })
      return
    }

    // Ambiguous non-error output: do not pretend the implementer failed.
    await addAgentReviewComment(
      taskRef,
      agentId,
      `${output || '(empty reviewer output)'}\n\nReviewer did not return APPROVED or CHANGES_REQUESTED. Leaving task in review; implementer not requeued.`,
    )
    await taskRef.update({
      columnId: 'review',
      agentStatus: 'done',
      reviewStatus: 'pending',
      reviewRetryAt: transientRetryAt(0),
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('dispatchReview threw', { taskId, agentId, error: message })
    try {
      // Do not thrash human-accepted cards back to pending review.
      const errSnap = await taskRef.get().catch(() => null)
      const errData = (errSnap?.data() ?? {}) as TaskData
      if (errData.reviewStatus === 'approved' || errData.columnId === 'done') {
        await addAgentReviewComment(taskRef, agentId, `Reviewer error after human accept (ignored): ${message}`)
        return
      }
      await addAgentReviewComment(taskRef, agentId, `Reviewer error: ${message}`)
      await taskRef.update({
        columnId: 'review',
        agentStatus: 'done',
        reviewStatus: 'pending',
        reviewRetryAt: isTransientHermesError(message) ? transientRetryAt(0, Date.now(), message) : transientRetryAt(0),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } catch {}
  } finally {
    inFlight.delete(`${taskRef.path}:review`)
    decAgent(agentId)
  }
}

async function releaseDueScheduledTasks(now = Date.now()): Promise<void> {
  if (scheduledReleaseSweepDisabled) return
  try {
    const snap = await db
      .collectionGroup('tasks')
      .where('agentReleaseStatus', '==', 'scheduled')
      .where('agentStatus', '==', 'pending')
      .limit(MAX_SCHEDULED_RELEASE_SWEEP_DOCS)
      .get()

    await Promise.all(snap.docs.map(async (doc) => {
      const data = (doc.data() ?? {}) as TaskData
      const dueAt = releaseMillis(data.agentReleaseAt)
      if (dueAt === null || dueAt > now) return
      await doc.ref.update({
        columnId: 'todo',
        agentReleaseStatus: 'released',
        agentReleasedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      await doc.ref.collection('comments').add({
        text: `Scheduled backlog release reached. Moved to To Do for agent pickup.`,
        userId: 'system:agent-watcher',
        userName: 'Agent watcher',
        userRole: 'system',
        createdAt: FieldValue.serverTimestamp(),
        agentPickedUp: false,
        agentPickedUpAt: null,
      })
    }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('FAILED_PRECONDITION')) {
      scheduledReleaseSweepDisabled = true
      logger.error('scheduled backlog release sweep disabled until the tasks collection-group index exists', { error: message })
      return
    }
    logger.error('scheduled backlog release sweep failed', {
      error: message,
    })
  }
}

async function releaseDependencyClearedDocs(
  docs: Array<{ ref: DocumentReference; data: () => Record<string, unknown> | undefined }>,
  waitingStatus: string,
  now: number,
  allowedAgentIds?: readonly string[],
): Promise<void> {
  await Promise.all(docs.map(async (doc) => {
    const data = (doc.data() ?? {}) as TaskData
    if (!isActiveAgentId(data.assigneeAgentId)) return
    if (allowedAgentIds && !allowedAgentIds.includes(data.assigneeAgentId)) return
    if (data.columnId !== 'blocked') return
    const dependencyGateIds = getTaskDependencyGateIds(data.dependsOn, data.approvalGateTaskId)
    if (dependencyGateIds.length === 0) return
    if (waitingStatus === 'blocked' && typeof data.agentOutput?.summary === 'string' && data.agentOutput.summary.trim()) return
    if (data.deleted === true || data.status === 'cancelled' || data.status === 'canceled') return
    if (hasPendingApprovalGate(data) || hasPendingScheduledRelease(data, now)) return

    const deps = await dependenciesResolved(doc.ref, data.dependsOn, data.approvalGateTaskId)
    if (!deps.ok) return

    const releasedData: TaskData = {
      ...data,
      agentStatus: 'pending',
      columnId: 'todo',
    }
    await doc.ref.update({
      ...agentStatusUpdate('pending'),
      agentHeartbeatAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    await doc.ref.collection('comments').add({
      text: `Dependency gate cleared. All dependsOn tasks are complete; moved back to To Do for agent pickup.`,
      userId: 'system:agent-watcher',
      userName: 'Agent watcher',
      userRole: 'system',
      createdAt: FieldValue.serverTimestamp(),
      agentPickedUp: false,
      agentPickedUpAt: null,
    })
    void dispatchTask(doc.ref, releasedData)
  }))
}

async function releaseDependencyClearedTasks(now = Date.now()): Promise<void> {
  const chunks = chunkAgentIds(currentAgentIds())
  for (const chunk of chunks) {
    for (const waitingStatus of ['awaiting-input', 'blocked']) {
      try {
        const snap = await db
          .collectionGroup('tasks')
          .where('assigneeAgentId', 'in', chunk)
          .where('agentStatus', '==', waitingStatus)
          .where('columnId', '==', 'blocked')
          .limit(MAX_DEPENDENCY_RELEASE_SWEEP_DOCS)
          .get()

        await releaseDependencyClearedDocs(snap.docs, waitingStatus, now)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('FAILED_PRECONDITION')) {
          logger.warn('dependency-cleared indexed sweep unavailable; falling back to agentStatus-only scan', {
            agents: chunk,
            agentStatus: waitingStatus,
            error: message,
          })
          try {
            const fallbackSnap = await db
              .collectionGroup('tasks')
              .where('agentStatus', '==', waitingStatus)
              .limit(MAX_DEPENDENCY_RELEASE_SWEEP_DOCS)
              .get()
            await releaseDependencyClearedDocs(fallbackSnap.docs, waitingStatus, now, chunk)
          } catch (fallbackErr) {
            logger.error('dependency-cleared task fallback release sweep failed', {
              agents: chunk,
              agentStatus: waitingStatus,
              error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            })
          }
          continue
        }
        logger.error('dependency-cleared task release sweep failed', {
          agents: chunk,
          agentStatus: waitingStatus,
          error: message,
        })
      }
    }
  }
}

export async function sweepReadyPendingTasks(now = Date.now()): Promise<void> {
  await releaseDueScheduledTasks(now)
  await releaseDependencyClearedTasks(now)
  const chunks = chunkAgentIds(currentAgentIds())
  for (const chunk of chunks) {
    try {
      const snap = await db
        .collectionGroup('tasks')
        .where('assigneeAgentId', 'in', chunk)
        .where('agentStatus', '==', 'pending')
        .where('columnId', '==', 'todo')
        .limit(MAX_READY_SWEEP_DOCS)
        .get()

      snap.docs.forEach((doc) => {
        const data = (doc.data() ?? {}) as TaskData
        void dispatchTask(doc.ref, data)
      })
    } catch (err) {
      logger.error('ready pending task sweep failed', {
        agents: chunk,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

export function inFlightCount(): number {
  return inFlight.size
}

export async function startWatcher(agentIds?: readonly string[]): Promise<() => void> {
  const enabledAgentIds = agentIds && agentIds.length > 0 ? Array.from(new Set(agentIds)) : await loadEnabledAgentIds()
  activeAgentIds = new Set(enabledAgentIds)
  const agentChunks = chunkAgentIds(currentAgentIds())

  logger.info('starting Firestore watcher', { agents: currentAgentIds() })

  const unsubscribes = agentChunks.map((chunk) => db
    .collectionGroup('tasks')
    .where('assigneeAgentId', 'in', chunk)
    .where('agentStatus', '==', 'pending')
    .where('columnId', '==', 'todo')
    .onSnapshot(
      (snap: QuerySnapshot) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added' && change.type !== 'modified') return
          const doc: DocumentSnapshot = change.doc
          const data = (doc.data() ?? {}) as TaskData
          // Fire-and-forget; dispatchTask owns its own error handling.
          void dispatchTask(doc.ref, data)
        })
      },
      (err: Error) => {
        logger.error('Firestore snapshot listener error', { error: err.message })
        // onSnapshot auto-reconnects internally; just log the surface error.
      },
    ))

  const reviewUnsubscribes = agentChunks.map((chunk) => db
    .collectionGroup('tasks')
    .where('reviewerAgentId', 'in', chunk)
    .where('columnId', '==', 'review')
    .where('reviewStatus', '==', 'pending')
    .onSnapshot(
      (snap: QuerySnapshot) => {
        snap.docChanges().forEach((change) => {
          if (change.type !== 'added' && change.type !== 'modified') return
          const doc: DocumentSnapshot = change.doc
          const data = (doc.data() ?? {}) as TaskData
          void dispatchReview(doc.ref, data)
        })
      },
      (err: Error) => logger.error('Firestore review snapshot listener error', { error: err.message }),
    ))

  // Dependency transitions are retried by sweepReadyPendingTasks(). Keeping this
  // as a bounded sweep avoids two broad "all done tasks" listeners per watcher.
  const readyTaskSweep = setInterval(() => {
    void sweepReadyPendingTasks()
  }, READY_TASK_SWEEP_MS)
  readyTaskSweep.unref?.()

  return () => {
    try {
      clearInterval(readyTaskSweep)
      unsubscribes.forEach((unsubscribe) => unsubscribe())
      reviewUnsubscribes.forEach((unsubscribe) => unsubscribe())
    } catch (err) {
      logger.warn('unsubscribe threw', { error: err instanceof Error ? err.message : String(err) })
    }
  }
}
