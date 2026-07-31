import type { ChatContextAdapter } from '@/lib/chat-context/access'
import { genericChatContextAdapter } from '@/lib/chat-context/adapters/generic'
import type {
  ChatContextAction,
  ContextActivitySummary,
  ContextAttentionSummary,
  ContextDisplayState,
} from '@/lib/chat-context/types'
import { adminDb } from '@/lib/firebase/admin'
import {
  canExecuteWorkspaceBrokerJob,
  WORKSPACE_BROKER_JOB_COLLECTION,
  type WorkspaceBrokerJob,
} from '@/lib/workspace-os/broker'

type RawDoc = Record<string, unknown>

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function dateString(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value && typeof value === 'object') {
    const raw = value as { toDate?: () => Date; toMillis?: () => number; seconds?: number; _seconds?: number }
    try {
      const converted = raw.toDate?.()
      if (converted && !Number.isNaN(converted.getTime())) return converted.toISOString()
      const millis = raw.toMillis?.()
      if (typeof millis === 'number' && Number.isFinite(millis)) return new Date(millis).toISOString()
      const seconds = raw.seconds ?? raw._seconds
      if (typeof seconds === 'number' && Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString()
    } catch {
      return undefined
    }
  }
  return undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => clean(item, 500) ? [clean(item, 500)] : []) : []
}

function jobActions(id: string, job: Partial<WorkspaceBrokerJob>, role: string): ChatContextAction[] {
  if (role !== 'admin') return []
  const href = `/api/v1/workspace-broker/jobs/${encodeURIComponent(id)}`
  if (job.approvalRequired === true && job.status === 'awaiting_approval' && clean(job.approvalGateTaskId)) {
    return [
      {
        id: `approve-workspace-job:${id}`,
        label: 'Approve workspace job',
        href,
        method: 'PATCH',
        requiresApproval: true,
        body: { action: 'approve', approvalGateTaskId: clean(job.approvalGateTaskId) },
      },
      {
        id: `reject-workspace-job:${id}`,
        label: 'Reject workspace job',
        href,
        method: 'PATCH',
        destructive: true,
        requiresApproval: true,
        body: { action: 'reject', approvalGateTaskId: clean(job.approvalGateTaskId) },
      },
    ]
  }
  if (canExecuteWorkspaceBrokerJob(job).ok) {
    return [{
      id: `execute-workspace-job:${id}`,
      label: 'Execute approved workspace job',
      href,
      method: 'PATCH',
      requiresApproval: true,
      body: { action: 'execute' },
    }]
  }
  return []
}

function stateFor(status: string): ContextDisplayState {
  if (status === 'done') return 'complete'
  if (status === 'running') return 'running'
  if (status === 'awaiting_approval') return 'needs_approval'
  if (status === 'failed' || status === 'blocked') return 'blocked'
  if (status === 'cancelled') return 'archived'
  if (status === 'queued') return 'ready'
  return 'waiting'
}

function activityFor(data: RawDoc): ContextActivitySummary[] {
  const completedAt = dateString(data.completedAt)
  const failedAt = dateString(data.failedAt)
  const startedAt = dateString(data.startedAt)
  const requestedAt = dateString(data.requestedAt)
  return [
    ...(completedAt ? [{ id: 'workspace-job-completed', type: 'verified_complete' as const, label: 'Workspace job completed', occurredAt: completedAt }] : []),
    ...(failedAt ? [{ id: 'workspace-job-failed', type: 'failure' as const, label: 'Workspace job failed', occurredAt: failedAt, ...(clean(data.error) ? { detail: clean(data.error) } : {}) }] : []),
    ...(startedAt ? [{ id: 'workspace-job-started', type: 'running' as const, label: 'Workspace job started', occurredAt: startedAt }] : []),
    ...(requestedAt ? [{ id: 'workspace-job-requested', type: 'pickup' as const, label: 'Workspace job requested', occurredAt: requestedAt }] : []),
  ]
}

export const workspaceBrokerJobChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'workspace_broker_job') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported workspace job context' }
    }
    const base = await genericChatContextAdapter.resolve(input)
    if (!base.ok) return base
    if (input.user.role === 'client') {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }
    const snap = await adminDb.collection(WORKSPACE_BROKER_JOB_COLLECTION).doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const data = snap.data() ?? {}
    if (clean(data.orgId, 200) !== base.model.context.orgId) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }
    const job = { id: snap.id, ...data } as unknown as WorkspaceBrokerJob & { id: string }
    const status = clean(job.status) || 'requested'
    const operation = clean(job.operation) || 'workspace operation'
    const actions = jobActions(snap.id, job, input.user.role)
    const resultArtifactIds = stringArray(job.resultArtifactIds ?? job.output?.resultArtifactIds)
    const resultArtifactUrls = stringArray(job.resultArtifactUrls ?? job.output?.resultArtifactUrls)
    const target = job.targetResource && typeof job.targetResource === 'object' ? job.targetResource : {}
    const targetLabel = clean(target.title) || clean(target.artifactId) || clean(target.folderId) || clean(target.projectId)
    const href = `/admin/briefings?workspaceJobId=${encodeURIComponent(snap.id)}&orgId=${encodeURIComponent(job.orgId)}`
    const attention: ContextAttentionSummary[] = status === 'awaiting_approval'
      ? [{
          id: 'workspace-job-approval',
          label: 'Workspace job needs approval',
          state: 'needs_approval',
          detail: `${titleCase(operation)} · ${titleCase(clean(job.riskLevel) || 'low')} risk`,
          href,
          ...(actions.length > 0 ? { actions } : {}),
        }]
      : status === 'failed' || status === 'blocked'
        ? [{
            id: 'workspace-job-failure',
            label: status === 'blocked' ? 'Workspace job is blocked' : 'Workspace job failed',
            state: 'blocked',
            detail: clean(job.error) || stringArray(job.errors)[0],
            href,
          }]
        : status === 'queued' && actions.length > 0
          ? [{
              id: 'workspace-job-ready',
              label: 'Approved workspace job is ready',
              state: 'needs_approval',
              detail: 'Confirm execution to perform the provider operation.',
              href,
              actions,
            }]
          : []

    return {
      ok: true,
      model: {
        context: {
          ...base.model.context,
          label: `${titleCase(operation)} workspace job`,
          href,
        },
        pulse: {
          label: 'Workspace broker job',
          metrics: [
            { id: 'status', label: 'Status', value: titleCase(status) },
            { id: 'risk', label: 'Risk', value: titleCase(clean(job.riskLevel) || 'low') },
            { id: 'capability', label: 'Capability', value: titleCase(clean(job.requiredCapability) || 'read') },
            { id: 'attempts', label: 'Attempts', value: typeof job.attempts === 'number' ? job.attempts : 0 },
            { id: 'artifacts', label: 'Result artifacts', value: resultArtifactIds.length },
          ],
          headline: [
            titleCase(operation),
            targetLabel ? `Target: ${targetLabel}` : '',
            clean(job.agentId) ? `Agent: ${clean(job.agentId)}` : '',
          ].filter(Boolean).join(' · '),
          ...(attention[0] ? {
            next: {
              id: attention[0].id,
              label: attention[0].label,
              state: attention[0].state,
              detail: attention[0].detail,
              href,
            },
          } : {}),
        },
        groups: [{
          id: 'job',
          label: 'Workspace operation',
          items: [{
            id: snap.id,
            label: titleCase(operation),
            state: stateFor(status),
            detail: [
              targetLabel ? `Target: ${targetLabel}` : '',
              clean(job.connectionId) ? `Connection: ${clean(job.connectionId)}` : '',
              resultArtifactUrls[0] ? `Result ready` : '',
            ].filter(Boolean).join(' · '),
            href,
            ...(dateString(job.updatedAt) ? { updatedAt: dateString(job.updatedAt) } : {}),
            ...(actions.length > 0 ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention,
        activity: activityFor(data),
        preview: {
          kind: 'summary',
          text: [
            `${titleCase(operation)} · ${titleCase(status)}`,
            targetLabel ? `Target ${targetLabel}` : '',
            clean(job.error) ? `Error: ${clean(job.error)}` : '',
            resultArtifactIds.length > 0 ? `${resultArtifactIds.length} result artifact${resultArtifactIds.length === 1 ? '' : 's'}` : '',
          ].filter(Boolean).join(' · '),
          status,
          ...(dateString(job.updatedAt) ? { version: dateString(job.updatedAt) } : {}),
        },
        capabilities: ['open', 'preview', 'approval-evidence', 'result-artifacts', ...(actions.length > 0 ? ['inline-actions'] : [])],
        asOf: new Date().toISOString(),
      },
    }
  },
}
