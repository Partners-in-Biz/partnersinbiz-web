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
  serializeWorkspaceConnection,
  WORKSPACE_CONNECTION_COLLECTION,
  type WorkspaceConnection,
} from '@/lib/workspace-os/connections'

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function titleCase(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function dateString(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
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

function connectionUpdatedAt(connection: WorkspaceConnection): string | undefined {
  const updatedAt = dateString((connection as { updatedAt?: unknown }).updatedAt)
  return updatedAt ?? dateString(connection.lastReviewedAt)
}

function stateForStatus(status: string, tokenStatus: string, deleted: boolean): ContextDisplayState {
  if (deleted || status === 'retired') return 'archived'
  if (status === 'paused' || status === 'revoked') return 'needs_input'
  if (status === 'proposed') return 'review'
  if (tokenStatus === 'needs_reconnect' || tokenStatus === 'invalid') return 'blocked'
  if (status === 'active' || status === 'approved') return 'ready'
  return 'waiting'
}

function connectionScopesText(scopes: WorkspaceConnection['scopes']): string {
  if (!scopes.length) return 'Scopes: none'
  const labels = scopes
    .map((scope) => `${clean(scope.scope)}${scope.approved ? '' : ' (pending)'}`)
    .filter(Boolean)
  return `Scopes (${labels.length}): ${labels.slice(0, 4).join(' · ')}`
}

function connectionCapabilities(connection: WorkspaceConnection): string {
  const enabled = Object.entries(connection.capabilities)
    .filter(([, value]) => value === true)
    .map(([key]) => key.replace('Read', ' read').replace('Write', ' write'))
    .map((item) => titleCase(item))
  return enabled.length ? `Capabilities: ${enabled.slice(0, 6).join(', ')}` : 'Capabilities: none'
}

function adminActions(id: string, connection: WorkspaceConnection): ChatContextAction[] {
  const baseHref = `/api/v1/workspace-connections/${encodeURIComponent(id)}`
  const actions: ChatContextAction[] = [{
    id: `approve-workspace-connection:${id}`,
    label: connection.status === 'active' ? 'Review connection' : 'Approve connection',
    href: `${baseHref}/review`,
    method: 'POST',
    requiresApproval: true,
    body: {
      status: 'active',
      approvalStatus: 'approved',
      ...(connection.approvalGateTaskId ? { approvalGateTaskId: clean(connection.approvalGateTaskId) } : {}),
    },
  }]

  if (connection.tokenStatus !== 'valid') {
    actions.push({
      id: `reconnect-workspace-connection:${id}`,
      label: 'Reconnect connection',
      href: `${baseHref}/reconnect`,
      method: 'POST',
      requiresApproval: true,
    })
  }

  if (connection.status !== 'retired') {
    actions.push({
      id: `retire-workspace-connection:${id}`,
      label: 'Retire connection',
      href: `${baseHref}/review`,
      method: 'POST',
      requiresApproval: true,
      destructive: true,
      body: { status: 'retired', approvalStatus: connection.approvalStatus || 'approved' },
    })
  }

  return actions
}

function activityFor(connection: WorkspaceConnection): ContextActivitySummary[] {
  const lastReviewed = dateString(connection.lastReviewedAt)
  const lastUpdated = connectionUpdatedAt(connection)
  return [
    ...(lastReviewed ? [{
      id: 'workspace-connection-reviewed',
      type: 'verified_complete' as const,
      label: 'Connection reviewed',
      occurredAt: lastReviewed,
      ...(clean(connection.lastReviewedBy) ? { actorLabel: clean(connection.lastReviewedBy) } : {}),
      ...(clean(connection.approvalStatus) ? { detail: clean(connection.approvalStatus) } : {}),
    }] : []),
    ...(lastUpdated ? [{
      id: 'workspace-connection-updated',
      type: 'running' as const,
      label: 'Connection updated',
      occurredAt: lastUpdated,
      detail: `Status: ${titleCase(clean(connection.status))}`,
    }] : []),
  ]
}

function attentionFor(connection: WorkspaceConnection, href: string, actions: ChatContextAction[]): ContextAttentionSummary[] {
  if (connection.status === 'proposed') {
    return [{
      id: 'workspace-connection-review-required',
      label: 'Workspace connection awaiting approval',
      state: 'needs_approval',
      detail: `${titleCase(clean(connection.status))} · ${titleCase(clean(connection.provider))}`,
      href,
      ...(actions.length > 0 ? { actions } : {}),
    }]
  }

  if (connection.tokenStatus === 'needs_reconnect' || connection.tokenStatus === 'invalid') {
    return [{
      id: 'workspace-connection-token-expired',
      label: 'Workspace connection needs refresh',
      state: 'needs_input',
      detail: `Token status: ${titleCase(clean(connection.tokenStatus))}`,
      href,
      ...(actions.length > 0 ? { actions } : {}),
    }]
  }

  if (connection.riskLevel === 'high' || connection.riskLevel === 'critical') {
    return [{
      id: 'workspace-connection-high-risk',
      label: 'Workspace connection risk is elevated',
      state: 'blocked',
      detail: `${titleCase(clean(connection.riskLevel))} risk with ${connectionScopesText(connection.scopes)}`,
      href,
      ...(actions.length > 0 ? { actions } : {}),
    }]
  }

  return []
}

export const workspaceConnectionChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'workspace_connection') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported workspace connection context' }
    }

    const base = await genericChatContextAdapter.resolve(input)
    if (!base.ok) return base

    const snap = await adminDb.collection(WORKSPACE_CONNECTION_COLLECTION).doc(input.id).get()
    if (!snap.exists) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const connection = serializeWorkspaceConnection(snap.id, snap.data() ?? {})
    if (connection.deleted || connection.orgId !== base.model.context.orgId) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    if (input.user.role === 'client') {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const status = stateForStatus(
      clean(connection.status),
      clean(connection.tokenStatus),
      connection.deleted,
    )
    const href = `/admin/workspace/connections/${encodeURIComponent(connection.id)}`
    const actions = adminActions(connection.id, connection)
    const attention = attentionFor(connection, href, actions)
    const scopes = connectionScopesText(connection.scopes)
    const ownerLabel = connection.ownerUserId || connection.ownerAgentId || 'unassigned'
    const serviceAccount = clean(connection.serviceAccountEmail)

    const relatedProjects: Array<{ type: 'project' | 'task' | 'document'; id: string; label: string; relation: string }> = []
    if (connection.projectId) {
      relatedProjects.push({
        type: 'project',
        id: clean(connection.projectId),
        label: `Project ${clean(connection.projectId)}`,
        relation: 'Connection project',
      })
    }
    if (connection.taskId) {
      relatedProjects.push({
        type: 'task',
        id: clean(connection.taskId),
        label: `Task ${clean(connection.taskId)}`,
        relation: 'Connection task',
      })
    }
    if (connection.clientDocumentId) {
      relatedProjects.push({
        type: 'document',
        id: clean(connection.clientDocumentId),
        label: `Document ${clean(connection.clientDocumentId)}`,
        relation: 'Source document',
      })
    }

    const relationships = relatedProjects.map((item) => ({
      kind: item.type,
      id: item.id,
      label: item.label,
      relation: item.relation,
      ...(item.id ? { href: `/admin/workspace/${item.type === 'task' ? 'broker/jobs' : `${item.type}s`}/${item.id}` } : {}),
    })).filter((item) => item.id)
    const updatedAt = connectionUpdatedAt(connection)
    const updateLabel = updatedAt ? `Updated ${updatedAt.slice(0, 10)}` : ''

    const capabilities = [
      ...(Object.entries(connection.capabilities).some(([, isEnabled]) => isEnabled) ? ['can-read', 'can-write'] : ['read-only']),
    ]

    return {
      ok: true,
      model: {
        context: {
          ...base.model.context,
          label: connection.displayName,
          href,
        },
        pulse: {
          label: 'Workspace connection',
          metrics: [
            { id: 'status', label: 'Status', value: titleCase(clean(connection.status)) },
            { id: 'token', label: 'Token', value: titleCase(clean(connection.tokenStatus) || 'Unknown') },
            { id: 'risk', label: 'Risk', value: titleCase(clean(connection.riskLevel) || 'Low') },
            { id: 'scopes', label: 'Scopes', value: String(connection.scopes.length || 0) },
            { id: 'provider', label: 'Provider', value: titleCase(clean(connection.provider || 'workspace')) },
          ],
          headline: [
            `Owner: ${ownerLabel}`,
            `Type: ${titleCase(clean(connection.connectionType))}`,
            scopes,
            ...(serviceAccount ? [`Service account: ${serviceAccount}`] : []),
            connection.approvalStatus ? `Approval: ${titleCase(clean(connection.approvalStatus))}` : '',
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
          id: 'connection',
          label: 'Workspace connection',
          items: [{
            id: connection.id,
            label: clean(connection.displayName),
            state: status,
            detail: [
              `Provider: ${titleCase(clean(connection.provider))}`,
              `Type: ${titleCase(clean(connection.connectionType))}`,
              `Approval: ${titleCase(clean(connection.approvalStatus) || 'Unknown')}`,
              ...(updateLabel ? [updateLabel] : []),
            ].filter(Boolean).join(' · '),
            href,
            ...(actions.length > 0 ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention,
        activity: activityFor(connection),
        preview: {
          kind: 'summary',
          text: [
            clean(connection.displayName),
            scopes,
            connectionCapabilities(connection),
            connection.connectionType ? titleCase(clean(connection.connectionType)) : '',
          ].filter(Boolean).join(' · '),
          status: titleCase(clean(connection.status)),
          ...(updatedAt ? { version: updatedAt } : {}),
        },
        ...(relationships.length > 0 ? { relationships } : {}),
        capabilities: ['open', 'preview', ...(actions.length > 0 ? ['inline-actions'] : []), ...capabilities],
        asOf: new Date().toISOString(),
      },
    }
  },
}
