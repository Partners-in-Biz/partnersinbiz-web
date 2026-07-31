/**
 * Auto-complete Hermes subagent branches back into the parent Messages thread.
 *
 * When a child run finishes, this path:
 * 1. completeDelegationChild on the durable delegation record
 * 2. patches the branch system message rich part (queued→running→done/failed)
 * 3. appends a structured summary message into the parent conversation
 *
 * Discovered via hermes_runs metadata.source = hermes-features-delegation
 * (see productionDelegationDeps) and also by open running children on the record.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { getAgentDispatchHermesProfileLink } from '@/lib/agents/team'
import { callHermesJson, HERMES_RUNS_COLLECTION } from '@/lib/hermes/server'
import type { RichMessagePart } from '@/lib/hermes/types'
import type { DelegationRecord } from '@/lib/hermes-features/repository'
import {
  HERMES_FEATURES_DELEGATION_SOURCE,
} from '@/lib/hermes-features/delegation-runtime'
import { hermesFeaturesService } from '@/lib/hermes-features/service'
import {
  extractHermesRunError,
  extractHermesRunOutput,
  normalizeHermesRunStatus,
} from '@/lib/conversations/run-finalizer'
import {
  buildAgentDelegationBranchPart,
  buildChildSummaryParentMessage,
  AGENT_DELEGATION_BRANCH_PART,
} from '@/lib/conversations/agent-delegation'
import {
  createMessage,
  messagesCollection,
  touchConversation,
} from '@/lib/conversations/conversations'

type JsonObject = Record<string, unknown>

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null
}

function metadataFromRunDoc(data: JsonObject): JsonObject {
  return asObject(data.metadata)
    ?? asObject(asObject(data.request)?.metadata)
    ?? asObject(asObject(data.response)?.metadata)
    ?? {}
}

function isDelegationSource(data: JsonObject, metadata: JsonObject): boolean {
  return cleanString(metadata.source) === HERMES_FEATURES_DELEGATION_SOURCE
    || cleanString(data.source) === HERMES_FEATURES_DELEGATION_SOURCE
}

function isCompletedStatus(status: string): boolean {
  return ['completed', 'complete', 'succeeded', 'success', 'done'].includes(status)
}

function isFailedStatus(status: string): boolean {
  return ['failed', 'error', 'errored', 'cancelled', 'canceled', 'stopped', 'interrupted'].includes(status)
}

export interface DelegationFinalizeResult {
  status: 'completed' | 'failed' | 'running' | 'skipped'
  orgId: string
  delegationId: string
  childId: string
  runId?: string
  alreadyFinal?: boolean
  summaryMessageId?: string
  /** Full parent-thread summary message when created by this finalize call. */
  summaryMessage?: Awaited<ReturnType<typeof createMessage>>
  branchMessageId?: string
  record?: DelegationRecord
  error?: string
}

/**
 * Pure-ish apply of a terminal child outcome onto the durable record + parent thread.
 * Shared by cron reconciler, manual POST complete, and tests.
 */
export async function finalizeDelegationChildRun(input: {
  orgId: string
  delegationId: string
  childId: string
  result: string
  ok: boolean
  runId?: string
  branchMessageId?: string
  conversationId?: string
}): Promise<DelegationFinalizeResult> {
  const existing = await hermesFeaturesService.observeDelegation(input.orgId, input.delegationId)
  if (!existing) {
    return {
      status: 'skipped',
      orgId: input.orgId,
      delegationId: input.delegationId,
      childId: input.childId,
      error: 'Delegation not found',
    }
  }

  const child = existing.children.find((c) => c.id === input.childId)
  if (!child) {
    return {
      status: 'skipped',
      orgId: input.orgId,
      delegationId: input.delegationId,
      childId: input.childId,
      error: 'Child not found',
    }
  }

  if (child.status === 'done' || child.status === 'failed' || child.status === 'unknown') {
    return {
      status: child.status === 'done' ? 'completed' : 'failed',
      orgId: input.orgId,
      delegationId: input.delegationId,
      childId: input.childId,
      alreadyFinal: true,
      record: existing,
      branchMessageId: existing.branchMessageId,
      runId: input.runId || child.runId,
    }
  }

  const record = await hermesFeaturesService.completeDelegationChild(
    input.orgId,
    input.delegationId,
    input.childId,
    input.result,
    input.ok,
  )

  const conversationId = input.conversationId || record.conversationId
  const branchMessageId = input.branchMessageId || record.branchMessageId

  if (conversationId && branchMessageId) {
    await patchBranchMessage(conversationId, branchMessageId, record).catch((err) => {
      console.error('[delegation-branch-patch-failed]', {
        conversationId,
        branchMessageId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  let summaryMessageId: string | undefined
  let summaryMessage: Awaited<ReturnType<typeof createMessage>> | undefined
  if (conversationId) {
    const summaryInput = buildChildSummaryParentMessage({
      conversationId,
      record,
      childId: input.childId,
    })
    if (summaryInput) {
      summaryMessage = await createMessage(conversationId, summaryInput)
      await touchConversation(
        conversationId,
        summaryMessage.content.slice(0, 200),
        summaryMessage.role,
        summaryMessage.id,
      )
      summaryMessageId = summaryMessage.id
    }
  }

  if (input.runId || child.runDocId) {
    await markRunDocFinal(input.runId || child.runId, child.runDocId, input.ok, input.result).catch(() => undefined)
  }

  return {
    status: input.ok ? 'completed' : 'failed',
    orgId: input.orgId,
    delegationId: input.delegationId,
    childId: input.childId,
    runId: input.runId || child.runId,
    branchMessageId,
    summaryMessageId,
    summaryMessage,
    record,
  }
}

async function patchBranchMessage(
  conversationId: string,
  branchMessageId: string,
  record: DelegationRecord,
): Promise<void> {
  const ref = messagesCollection(conversationId).doc(branchMessageId)
  const snap = await ref.get()
  if (!snap.exists) return
  const data = snap.data() ?? {}
  const part = buildAgentDelegationBranchPart(record) as unknown as RichMessagePart
  const existingParts = Array.isArray(data.richParts) ? data.richParts as RichMessagePart[] : []
  const nextParts = existingParts.some((p) => p?.type === AGENT_DELEGATION_BRANCH_PART)
    ? existingParts.map((p) => (p?.type === AGENT_DELEGATION_BRANCH_PART ? part : p))
    : [part, ...existingParts]

  const lines = (part as unknown as { children: Array<{ agentId: string; status: string; goal: string }> }).children
    .map((c) => `· ${c.agentId} [${c.status.toUpperCase()}] ${c.goal.slice(0, 120)}`)
  const content = [
    `Subagent branch (${(part as unknown as { status: string }).status})`,
    ...lines,
    'Only structured child summaries re-enter this thread when complete.',
  ].join('\n')

  await ref.update({
    content,
    richParts: nextParts,
    updatedAt: FieldValue.serverTimestamp(),
  })
}

async function markRunDocFinal(
  runId: string | undefined,
  runDocId: string | undefined,
  ok: boolean,
  result: string,
): Promise<void> {
  const patch = {
    status: ok ? 'completed' : 'failed',
    output: result.slice(0, 4000),
    updatedAt: FieldValue.serverTimestamp(),
    delegationFinalized: true,
  }
  if (runDocId) {
    await adminDb.collection(HERMES_RUNS_COLLECTION).doc(runDocId).set(patch, { merge: true })
    return
  }
  if (!runId) return
  const snap = await adminDb.collection(HERMES_RUNS_COLLECTION).where('hermesRunId', '==', runId).limit(1).get()
  if (!snap.empty) await snap.docs[0].ref.set(patch, { merge: true })
}

export interface PendingDelegationCandidate {
  orgId: string
  delegationId: string
  childId: string
  runId: string
  runDocId?: string
  conversationId?: string
  branchMessageId?: string
  agentId: string
}

/**
 * Discover open hermes-features-delegation runs that may need parent re-entry.
 */
export async function findPendingDelegationChildRuns(input: {
  maxRuns?: number
} = {}): Promise<PendingDelegationCandidate[]> {
  const maxRuns = Math.max(1, Math.min(input.maxRuns ?? 25, 50))
  const candidates: PendingDelegationCandidate[] = []
  const seen = new Set<string>()

  const add = (row: PendingDelegationCandidate) => {
    const key = `${row.orgId}::${row.delegationId}::${row.childId}`
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(row)
  }

  try {
    const activeSnap = await adminDb
      .collection(HERMES_RUNS_COLLECTION)
      .where('status', 'in', ['started', 'submitted', 'running', 'pending', 'streaming', 'completed', 'failed'])
      .limit(maxRuns * 3)
      .get()

    for (const doc of activeSnap.docs) {
      if (candidates.length >= maxRuns) break
      const data = (doc.data() ?? {}) as JsonObject
      if (data.delegationFinalized === true) continue
      const metadata = metadataFromRunDoc(data)
      if (!isDelegationSource(data, metadata)) continue

      const orgId = cleanString(metadata.orgId) ?? cleanString(data.orgId)
      const delegationId = cleanString(metadata.delegationId)
      const childId = cleanString(metadata.childId)
      const runId = cleanString(data.hermesRunId ?? data.runId ?? metadata.runId) ?? doc.id
      const agentId = cleanString(metadata.dispatchAgentId ?? metadata.agentId) ?? 'pip'
      if (!orgId || !delegationId || !childId || !runId) continue

      add({
        orgId,
        delegationId,
        childId,
        runId,
        runDocId: doc.id,
        conversationId: cleanString(metadata.conversationId ?? data.conversationId) ?? undefined,
        branchMessageId: cleanString(metadata.branchMessageId ?? metadata.messageId) ?? undefined,
        agentId,
      })
    }
  } catch (err) {
    console.warn('[delegation-run-discovery-failed]', err)
  }

  return candidates.slice(0, maxRuns)
}

export async function reconcilePendingDelegationRuns(input: {
  maxRuns?: number
} = {}) {
  const candidates = await findPendingDelegationChildRuns(input)
  const summary = {
    candidates: candidates.length,
    processed: 0,
    completed: 0,
    failed: 0,
    running: 0,
    skipped: 0,
    errors: 0,
  }

  for (const candidate of candidates) {
    try {
      const result = await pollAndFinalizeDelegationCandidate(candidate)
      summary.processed += 1
      if (result.status === 'completed') summary.completed += 1
      else if (result.status === 'failed') summary.failed += 1
      else if (result.status === 'running') summary.running += 1
      else summary.skipped += 1
    } catch (err) {
      summary.errors += 1
      console.error('[delegation-run-reconcile-error]', {
        ...candidate,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return summary
}

async function pollAndFinalizeDelegationCandidate(
  candidate: PendingDelegationCandidate,
): Promise<DelegationFinalizeResult> {
  // Prefer durable record state when already terminal.
  const record = await hermesFeaturesService.observeDelegation(candidate.orgId, candidate.delegationId)
  if (record) {
    const child = record.children.find((c) => c.id === candidate.childId)
    if (child && (child.status === 'done' || child.status === 'failed' || child.status === 'unknown')) {
      return {
        status: child.status === 'done' ? 'completed' : 'failed',
        orgId: candidate.orgId,
        delegationId: candidate.delegationId,
        childId: candidate.childId,
        alreadyFinal: true,
        record,
      }
    }
  }

  const agentLink = await getAgentDispatchHermesProfileLink(candidate.agentId, candidate.orgId)
  if (!agentLink) {
    return finalizeDelegationChildRun({
      orgId: candidate.orgId,
      delegationId: candidate.delegationId,
      childId: candidate.childId,
      result: 'No Hermes profile link for child agent',
      ok: false,
      runId: candidate.runId,
      branchMessageId: candidate.branchMessageId || record?.branchMessageId,
      conversationId: candidate.conversationId || record?.conversationId,
    })
  }

  const { response, data } = await callHermesJson(
    agentLink,
    `/v1/runs/${encodeURIComponent(candidate.runId)}`,
  )

  if (!response.ok) {
    if (response.status === 404) {
      return {
        status: 'running',
        orgId: candidate.orgId,
        delegationId: candidate.delegationId,
        childId: candidate.childId,
        runId: candidate.runId,
        error: 'Run not found yet',
      }
    }
    throw new Error(`Failed to fetch Hermes delegation run (${response.status})`)
  }

  const hermesStatus = normalizeHermesRunStatus(data)
  if (isCompletedStatus(hermesStatus)) {
    const output = extractHermesRunOutput(data) || 'Agent completed but returned no text output.'
    return finalizeDelegationChildRun({
      orgId: candidate.orgId,
      delegationId: candidate.delegationId,
      childId: candidate.childId,
      result: output,
      ok: true,
      runId: candidate.runId,
      branchMessageId: candidate.branchMessageId || record?.branchMessageId,
      conversationId: candidate.conversationId || record?.conversationId,
    })
  }

  if (isFailedStatus(hermesStatus)) {
    const error = extractHermesRunError(data)
      || extractHermesRunOutput(data)
      || `Run ${hermesStatus}`
    return finalizeDelegationChildRun({
      orgId: candidate.orgId,
      delegationId: candidate.delegationId,
      childId: candidate.childId,
      result: error,
      ok: false,
      runId: candidate.runId,
      branchMessageId: candidate.branchMessageId || record?.branchMessageId,
      conversationId: candidate.conversationId || record?.conversationId,
    })
  }

  return {
    status: 'running',
    orgId: candidate.orgId,
    delegationId: candidate.delegationId,
    childId: candidate.childId,
    runId: candidate.runId,
  }
}
