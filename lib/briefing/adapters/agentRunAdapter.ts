/**
 * Source adapter for live Hermes agent runs.
 *
 * Turns agent runtime state into Briefings cards so operators can see paused,
 * running, failed, and finished work from the same control desk as task output.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface AgentRunDocument extends Record<string, unknown> {
  orgId?: string | null
  profile?: string | null
  hermesRunId?: string | null
  requestedBy?: string | null
  prompt?: string | null
  status?: string | null
  output?: unknown
  result?: unknown
  error?: unknown
  approval?: {
    toolName?: string | null
    reason?: string | null
  } | null
  createdAt?: unknown
  updatedAt?: unknown
  completedAt?: unknown
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function runOrgId(doc: AgentRunDocument): string {
  return clean(doc.orgId) ?? extractOrgId(doc) ?? ''
}

function runStatus(doc: AgentRunDocument): string {
  return (clean(doc.status) ?? 'unknown').toLowerCase().replace(/\s+/g, '_')
}

function isWaitingApproval(status: string): boolean {
  return ['waiting_for_approval', 'waiting_approval', 'awaiting_approval', 'approval_required'].includes(status)
}

function isRunning(status: string): boolean {
  return ['running', 'in_progress', 'in-progress', 'streaming', 'queued', 'pending'].includes(status)
}

function isFailed(status: string): boolean {
  return ['failed', 'error', 'errored', 'cancelled', 'canceled'].includes(status)
}

function isCompleted(status: string): boolean {
  return ['completed', 'complete', 'done', 'succeeded', 'success'].includes(status)
}

/**
 * Freshness windows. Completed runs are only briefing-worthy for a day; a run
 * that still claims to be running but has not been touched for two days is
 * zombie state, not live work. Failed and approval-paused runs are real work
 * regardless of age and are never age-gated.
 *
 * "Now" is read from `Date.now()` so tests can pin the clock with
 * `jest.useFakeTimers({ now })`, matching the rest of the briefing suite.
 */
const COMPLETED_RUN_WINDOW_MS = 24 * 60 * 60 * 1000
const RUNNING_RUN_WINDOW_MS = 48 * 60 * 60 * 1000

function isWithinWindow(timestamp: Date | null, windowMs: number): boolean {
  if (!timestamp) return false
  const age = Date.now() - timestamp.getTime()
  return age <= windowMs
}

function completedRunIsFresh(doc: AgentRunDocument): boolean {
  const finishedAt = normalizeTimestamp(doc.completedAt) ?? normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt)
  return isWithinWindow(finishedAt, COMPLETED_RUN_WINDOW_MS)
}

function runningRunIsFresh(doc: AgentRunDocument): boolean {
  const touchedAt = normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt)
  return isWithinWindow(touchedAt, RUNNING_RUN_WINDOW_MS)
}

function agentIdFromProfile(profile: unknown): string {
  const raw = clean(profile) ?? 'unknown'
  return raw.replace(/-main$/i, '').replace(/^agent:/i, '') || 'unknown'
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function runId(doc: AgentRunDocument, docId: string): string {
  return clean(doc.hermesRunId) ?? docId
}

function outputText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return null
    }
  }
  return null
}

export const agentRunAdapter: BriefingSourceAdapter<AgentRunDocument> = {
  sourceType: 'agent-run',
  collectionPath: 'hermes_runs',

  hashSource(doc: AgentRunDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['profile', 'hermesRunId', 'requestedBy', 'prompt', 'status', 'output', 'result', 'error', 'approval', 'updatedAt', 'completedAt'])
  },

  shouldGenerate(doc: AgentRunDocument): boolean {
    const status = runStatus(doc)
    // Approval-paused and failed runs are real work at any age.
    if (isWaitingApproval(status) || isFailed(status)) return true
    // Live runs only count while they are actually being touched.
    if (isRunning(status)) return runningRunIsFresh(doc)
    // Finished runs are only FYI for the first day.
    if (isCompleted(status)) return completedRunIsFresh(doc)
    return false
  },

  extractPriority(doc: AgentRunDocument): BriefingPriority {
    const status = runStatus(doc)
    if (isWaitingApproval(status)) return 'needs-peet'
    // Agent-run failures are ops review work, not human-blocking critical
    if (isFailed(status)) return 'review'
    if (isRunning(status)) return 'progress'
    if (isCompleted(status)) return 'fyi'
    return 'fyi'
  },

  extractActor(doc: AgentRunDocument) {
    const agentId = agentIdFromProfile(doc.profile)
    return {
      id: `agent:${agentId}`,
      name: titleCase(agentId),
      role: 'ai' as const,
      type: 'agent' as const,
    }
  },

  extractContext(doc: AgentRunDocument, docId: string) {
    return {
      orgId: runOrgId(doc),
      agentRunId: runId(doc, docId),
      agentProfile: clean(doc.profile),
    }
  },

  extractTitle(doc: AgentRunDocument): string {
    const agentName = titleCase(agentIdFromProfile(doc.profile))
    const status = runStatus(doc)
    if (isWaitingApproval(status)) return `${agentName} paused for approval`
    if (isFailed(status)) return `${agentName} run needs recovery`
    if (isRunning(status)) return `${agentName} is running`
    if (isCompleted(status)) return `${agentName} finished a run`
    return `${agentName} run changed`
  },

  extractSummary(doc: AgentRunDocument): string {
    const agentName = titleCase(agentIdFromProfile(doc.profile))
    const status = runStatus(doc)
    if (isWaitingApproval(status)) {
      const tool = clean(doc.approval?.toolName)
      return tool ? `${agentName} is waiting for approval to run ${tool}.` : `${agentName} is waiting for approval.`
    }
    if (isFailed(status)) return `${agentName} run failed and needs review.`
    if (isRunning(status)) return `${agentName} has active work in progress.`
    if (isCompleted(status)) return `${agentName} finished work and left output for review.`
    return `${agentName} run status changed to ${status}.`
  },

  extractExcerpt(doc: AgentRunDocument, _docId: string, maxLength = 300): string | null {
    const approvalReason = clean(doc.approval?.reason)
    const prompt = clean(doc.prompt)
    const approvalWithPrompt = [approvalReason, prompt].filter(Boolean).join(' | ')
    return extractMultiFieldExcerpt({
      approvalWithPrompt,
      output: outputText(doc.output ?? doc.result),
      error: outputText(doc.error),
    }, ['approvalWithPrompt', 'error', 'output'], { maxLength })
  },

  extractOccurredAt(doc: AgentRunDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.completedAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: AgentRunDocument, docId: string): Record<string, unknown> | null {
    return {
      agentId: agentIdFromProfile(doc.profile),
      agentProfile: clean(doc.profile),
      runStatus: runStatus(doc),
      hermesRunId: runId(doc, docId),
      requestedBy: clean(doc.requestedBy),
      approvalToolName: clean(doc.approval?.toolName),
      approvalReason: clean(doc.approval?.reason),
    }
  },

  toItem(doc: AgentRunDocument, docId: string) {
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    const agentId = agentIdFromProfile(doc.profile)
    const hermesRunId = runId(doc, docId)
    return {
      orgId: runOrgId(doc),
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: `/admin/agents/${encodeURIComponent(agentId)}?run=${encodeURIComponent(hermesRunId)}`,
      },
      priority: this.extractPriority(doc, docId),
      status: 'active',
      title: this.extractTitle(doc, docId),
      summary: this.extractSummary(doc, docId),
      excerpt: this.extractExcerpt(doc, docId),
      actor: this.extractActor(doc, docId),
      context: this.extractContext(doc, docId),
      occurredAt,
      sourceHash: this.hashSource(doc, docId),
      metadata: this.extractMetadata?.(doc, docId),
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }
  },
}
