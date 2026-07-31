import type { ChatContextAdapter } from '@/lib/chat-context/access'
import { genericChatContextAdapter } from '@/lib/chat-context/adapters/generic'
import type {
  ChatContextAction,
  ChatContextRelationship,
  ContextActivitySummary,
  ContextAttentionSummary,
  ContextDisplayState,
} from '@/lib/chat-context/types'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { adminDb } from '@/lib/firebase/admin'
import {
  canReadWorkspaceArtifact,
  serializeWorkspaceArtifact,
  WORKSPACE_ARTIFACT_COLLECTION,
  type WorkspaceArtifact,
} from '@/lib/workspace-os/artifacts'

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function safeUrl(value: unknown): string | undefined {
  const raw = clean(value, 1000)
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function stateFor(artifact: WorkspaceArtifact): ContextDisplayState {
  if (artifact.deleted || artifact.lifecycleStatus === 'archived') return 'archived'
  if (artifact.permissions.aclAlignmentStatus === 'broader_than_pib') return 'blocked'
  if (artifact.sync.conflictStatus && artifact.sync.conflictStatus !== 'none') return 'blocked'
  if (artifact.lifecycleStatus === 'client_visible') return 'published'
  if (artifact.lifecycleStatus === 'approved') return 'ready'
  if (artifact.lifecycleStatus === 'internal_review') return 'review'
  return 'needs_input'
}

function auditAction(artifact: WorkspaceArtifact & { id: string }, role: string): ChatContextAction[] {
  if (role !== 'admin' || !artifact.connectionId || !artifact.google.fileId) return []
  return [{
    id: `audit-workspace-artifact:${artifact.id}`,
    label: 'Run permission audit',
    href: `/api/v1/workspace-broker/artifacts/${encodeURIComponent(artifact.id)}/permission-audit`,
    method: 'POST',
    requiresApproval: true,
    body: {},
  }]
}

function activityFor(artifact: WorkspaceArtifact): ContextActivitySummary[] {
  return [
    ...(artifact.permissions.lastCheckedAt && Number.isFinite(Date.parse(artifact.permissions.lastCheckedAt))
      ? [{ id: 'artifact-permissions-checked', type: 'verified_complete' as const, label: 'Permissions checked', occurredAt: new Date(artifact.permissions.lastCheckedAt).toISOString() }]
      : []),
    ...(artifact.sync.lastSyncedAt && Number.isFinite(Date.parse(artifact.sync.lastSyncedAt))
      ? [{ id: 'artifact-synced', type: 'running' as const, label: 'Artifact synced', occurredAt: new Date(artifact.sync.lastSyncedAt).toISOString() }]
      : []),
    ...(artifact.audit.lastReviewedAt && Number.isFinite(Date.parse(artifact.audit.lastReviewedAt))
      ? [{ id: 'artifact-reviewed', type: 'review_required' as const, label: 'Artifact reviewed', occurredAt: new Date(artifact.audit.lastReviewedAt).toISOString(), ...(artifact.audit.lastReviewedBy ? { actorLabel: artifact.audit.lastReviewedBy } : {}) }]
      : []),
  ]
}

async function relationshipsFor(
  artifact: WorkspaceArtifact,
  input: Parameters<ChatContextAdapter['resolve']>[0],
): Promise<ChatContextRelationship[]> {
  const seeds = [
    ...(artifact.projectId ? [{ type: 'project' as const, id: artifact.projectId, relation: 'Project' }] : []),
    ...(artifact.taskId ? [{
      type: 'task' as const,
      id: artifact.taskId,
      relation: 'Task',
      metadata: artifact.projectId ? { projectId: artifact.projectId } : undefined,
    }] : []),
    ...(artifact.clientDocumentId ? [{ type: 'document' as const, id: artifact.clientDocumentId, relation: 'Client document' }] : []),
    ...(artifact.sourceResearchItemId ? [{ type: 'research' as const, id: artifact.sourceResearchItemId, relation: 'Source research' }] : []),
  ]
  const refs = await resolveContextReferences(
    seeds.map(({ relation: _relation, ...seed }) => ({ ...seed, orgId: artifact.orgId, origin: 'manual' as const })),
    input.user,
    artifact.orgId,
  )
  return refs.map((ref) => {
    const seed = seeds.find((item) => item.type === ref.type && item.id === ref.id)
    return {
      kind: ref.type,
      id: ref.id,
      label: ref.label,
      relation: seed?.relation || 'Related record',
      ...(ref.href ? { href: ref.href } : {}),
    }
  })
}

export const workspaceArtifactChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'workspace_artifact') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported workspace artifact context' }
    }
    const base = await genericChatContextAdapter.resolve(input)
    if (!base.ok) return base
    const snap = await adminDb.collection(WORKSPACE_ARTIFACT_COLLECTION).doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const artifact = serializeWorkspaceArtifact(snap.id, snap.data() ?? {})
    if (artifact.deleted || artifact.orgId !== base.model.context.orgId || !canReadWorkspaceArtifact(artifact, input.user)) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }
    const actions = auditAction(artifact, input.user.role)
    const providerUrl = safeUrl(artifact.google.webViewLink) || safeUrl(artifact.google.url)
    const href = providerUrl || safeUrl(artifact.piBCanonicalUrl) || `/admin/briefings?workspaceArtifactId=${encodeURIComponent(artifact.id)}&orgId=${encodeURIComponent(artifact.orgId)}`
    const relationships = await relationshipsFor(artifact, input)
    const alignment = artifact.permissions.aclAlignmentStatus || 'unknown'
    const conflict = artifact.sync.conflictStatus || 'none'
    const attention: ContextAttentionSummary[] = alignment === 'broader_than_pib'
      ? [{
          id: 'artifact-acl-too-broad',
          label: 'Provider access is broader than PiB visibility',
          state: 'blocked',
          detail: 'Review provider permissions before sharing or publishing this artifact.',
          href,
          ...(actions.length > 0 ? { actions } : {}),
        }]
      : conflict !== 'none'
        ? [{
            id: 'artifact-sync-conflict',
            label: 'Workspace sync conflict needs review',
            state: 'blocked',
            detail: titleCase(conflict),
            href,
          }]
        : alignment === 'unknown'
          ? [{
              id: 'artifact-acl-unknown',
              label: 'Provider permissions have not been verified',
              state: 'review',
              detail: 'Run a permission audit before wider use.',
              href,
              ...(actions.length > 0 ? { actions } : {}),
            }]
          : []

    return {
      ok: true,
      model: {
        context: { ...base.model.context, label: artifact.title, href },
        pulse: {
          label: 'Workspace artifact',
          metrics: [
            { id: 'type', label: 'Type', value: titleCase(artifact.artifactType) },
            { id: 'lifecycle', label: 'Lifecycle', value: titleCase(artifact.lifecycleStatus) },
            { id: 'visibility', label: 'Visibility', value: titleCase(artifact.visibility) },
            { id: 'acl', label: 'Provider ACL', value: titleCase(alignment) },
            { id: 'sync', label: 'Sync', value: titleCase(artifact.sync.syncStatus || 'not configured') },
          ],
          headline: [
            artifact.naming.versionLabel ? `Version ${artifact.naming.versionLabel}` : '',
            artifact.owner.id ? `Owner: ${artifact.owner.id}` : '',
            artifact.agentId ? `Agent: ${artifact.agentId}` : '',
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
          id: 'artifact',
          label: 'Workspace deliverable',
          items: [{
            id: artifact.id,
            label: artifact.title,
            state: stateFor(artifact),
            detail: [
              titleCase(artifact.artifactType),
              artifact.naming.versionLabel ? `Version ${artifact.naming.versionLabel}` : '',
              artifact.mimeType || '',
            ].filter(Boolean).join(' · '),
            href,
            ...(actions.length > 0 ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention,
        activity: activityFor(artifact),
        preview: {
          kind: 'summary',
          text: `${artifact.title} · ${titleCase(artifact.lifecycleStatus)} · ${titleCase(alignment)}`,
          status: artifact.lifecycleStatus,
          ...(artifact.sourceSpecVersion ? { version: artifact.sourceSpecVersion } : {}),
        },
        ...(relationships.length > 0 ? { relationships } : {}),
        capabilities: ['open', 'preview', 'permissions', 'sync', ...(actions.length > 0 ? ['inline-actions'] : [])],
        asOf: new Date().toISOString(),
      },
    }
  },
}
