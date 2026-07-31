import type { ChatContextAdapter } from '@/lib/chat-context/access'
import { genericChatContextAdapter } from '@/lib/chat-context/adapters/generic'
import type {
  ChatContextAction,
  ChatContextRelationship,
  ContextActivitySummary,
  ContextAttentionSummary,
  ContextDisplayState,
  ChatContextReadModel,
} from '@/lib/chat-context/types'
import type { ChatContextResolveResult } from '@/lib/chat-context/access'
import { resolveContextReferences } from '@/lib/context-references/registry'
import type { ContextReferenceType } from '@/lib/context-references/types'
import { adminDb } from '@/lib/firebase/admin'
import {
  canReadWorkspaceFolder,
  serializeWorkspaceFolder,
  WORKSPACE_FOLDER_COLLECTION,
  type WorkspaceFolder,
} from '@/lib/workspace-folders/model'

function clean(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function dateString(value: unknown): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value && typeof value === 'object') {
    const raw = value as { toDate?: () => Date; toMillis?: () => number; _seconds?: number; seconds?: number }
    try {
      const asDate = raw.toDate?.()
      if (asDate instanceof Date && Number.isFinite(asDate.getTime())) return asDate.toISOString()
      const asMillis = raw.toMillis?.()
      if (typeof asMillis === 'number' && Number.isFinite(asMillis)) return new Date(asMillis).toISOString()
      const seconds = raw.seconds ?? raw._seconds
      if (typeof seconds === 'number' && Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString()
    } catch {
      return undefined
    }
  }
  return undefined
}

function titleCase(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function stateForStatus(syncStatus: string, conflict: string, risk: string): ContextDisplayState {
  if (syncStatus === 'conflict' || conflict === 'open') return 'blocked'
  if (syncStatus === 'error' || syncStatus === 'paused') return 'needs_input'
  if (['syncing', 'pending'].includes(syncStatus)) return syncStatus === 'syncing' ? 'running' : 'waiting'
  if (risk === 'high' || risk === 'critical') return 'blocked'
  if (syncStatus === 'not_configured') return 'review'
  return 'ready'
}

function fallbackForWorkbenchDirectory(input: {
  id: string
  workbenchPath: string
  base: ChatContextReadModel
}): ChatContextResolveResult {
  const fallbackLabel = input.workbenchPath || input.base.context.label || `folder:${input.id}`
  return {
    ok: true,
    model: {
      ...input.base,
      context: {
        ...input.base.context,
        label: fallbackLabel,
      },
      pulse: {
        ...input.base.pulse,
        metrics: [
          { id: 'source', label: 'Source', value: 'Linked workbench path' },
          { id: 'path', label: 'Folder path', value: input.workbenchPath },
        ],
        headline: `Path: ${input.workbenchPath}`,
        label: 'Linked folder',
      },
      groups: [{
        id: 'linked-folder',
        label: 'Linked folder',
        items: [{
          id: input.id,
          label: fallbackLabel,
          state: 'ready',
          detail: `Path: ${input.workbenchPath}`,
          href: '/workspace/folders',
          ...(input.base.context.href ? { href: input.base.context.href } : {}),
        }],
      }],
      artifacts: [],
      attention: [],
      activity: [],
      capabilities: ['open', 'preview'],
      asOf: new Date().toISOString(),
    },
  }
}

function relationshipSeedsFrom(folder: Pick<
WorkspaceFolder,
  'projectId' | 'taskId' | 'connectionId' | 'clientDocumentId' | 'orgId'
>): Array<{ kind: ContextReferenceType; id: string; relation: string }> {
  const seeds: Array<{ kind: ContextReferenceType; id: string; relation: string }> = []
  if (folder.projectId) seeds.push({ kind: 'project', id: folder.projectId, relation: 'Project' })
  if (folder.taskId) seeds.push({ kind: 'task', id: folder.taskId, relation: 'Task' })
  if (folder.clientDocumentId) seeds.push({ kind: 'document', id: folder.clientDocumentId, relation: 'Client document' })
  if (folder.connectionId) seeds.push({ kind: 'workspace_connection', id: folder.connectionId, relation: 'Workspace connection' })
  return seeds
}

async function relationships(folder: WorkspaceFolder, user: Parameters<ChatContextAdapter['resolve']>[0]['user']) {
  const seeds = relationshipSeedsFrom(folder).map((seed) => ({
    type: seed.kind,
    id: seed.id,
    orgId: folder.orgId,
    origin: 'manual' as const,
  }))
  if (!seeds.length) return []

  const refs = await resolveContextReferences(seeds, user, folder.orgId)
  const relationSeeds = relationshipSeedsFrom(folder)
  const related = refs.map((ref) => {
    const seed = relationSeeds.find((item) => item.kind === ref.type && item.id === ref.id)
    return {
      kind: ref.type,
      id: ref.id,
      label: ref.label,
      relation: seed?.relation ?? 'Related',
      ...(ref.href ? { href: ref.href } : {}),
    }
  })
  return related.filter((item): item is ChatContextRelationship => Boolean(item.kind && item.id && item.label && item.relation))
}

function activityFor(folder: WorkspaceFolder): ContextActivitySummary[] {
  const synced = dateString(folder.syncState.lastSyncedAt)
  const reviewed = dateString(folder.audit.lastReviewedAt)
  const conflicted = dateString(folder.audit.lastConflictAt)
  return [
    ...(synced ? [{
      id: `folder-sync-${folder.id}`,
      type: 'running' as const,
      label: 'Folder synced',
      occurredAt: synced,
    }] : []),
    ...(reviewed ? [{
      id: `folder-reviewed-${folder.id}`,
      type: 'verified_complete' as const,
      label: 'Folder reviewed',
      occurredAt: reviewed,
      ...(folder.audit.lastReviewedBy ? { actorLabel: folder.audit.lastReviewedBy } : {}),
    }] : []),
    ...(conflicted ? [{
      id: `folder-conflict-${folder.id}`,
      type: 'failure' as const,
      label: 'Folder conflict recorded',
      occurredAt: conflicted,
      detail: folder.audit.conflictStatus,
    }] : []),
  ]
}

function attentionFor(folder: WorkspaceFolder, href: string, actions: ChatContextAction[]): ContextAttentionSummary[] {
  if (folder.syncState.status === 'error' || folder.syncState.status === 'conflict') {
    return [{
      id: `workspace-folder-${folder.id}-sync-${folder.syncState.status}`,
      label: folder.syncState.status === 'error' ? 'Folder sync needs repair' : 'Folder sync conflict needs review',
      state: folder.syncState.status === 'error' ? 'needs_input' : 'review',
      detail: clean(folder.syncState.error, 220) || 'Check conflict and resync settings.',
      href,
      ...(actions.length > 0 ? { actions } : {}),
    }]
  }
  if (folder.audit.conflictStatus === 'open' || folder.syncState.conflictCount > 0) {
    return [{
      id: `workspace-folder-${folder.id}-conflicts`,
      label: 'Open sync conflicts',
      state: 'needs_input',
      detail: `${folder.syncState.conflictCount} open conflict${folder.syncState.conflictCount === 1 ? '' : 's'} in the folder sync plan.`,
      href,
      ...(actions.length > 0 ? { actions } : {}),
    }]
  }
  if (folder.audit.riskLevel === 'high' || folder.audit.riskLevel === 'critical') {
    return [{
      id: `workspace-folder-${folder.id}-risk`,
      label: 'Folder risk level elevated',
      state: 'blocked',
      detail: `Risk: ${titleCase(clean(folder.audit.riskLevel))}`,
      href,
      ...(actions.length > 0 ? { actions } : {}),
    }]
  }
  return []
}

function folderActions(folder: WorkspaceFolder, userRole: string): ChatContextAction[] {
  if (userRole !== 'admin') return []
  const id = folder.id ?? ''
  const href = `/api/v1/workspace-folders/${encodeURIComponent(id)}/resync?orgId=${encodeURIComponent(folder.orgId)}`
  return [{
    id: `resync-workspace-folder:${folder.id}`,
    label: 'Request manual resync',
    href,
    method: 'POST',
    requiresApproval: true,
  }]
}

export const workspaceFolderChatContextAdapter: ChatContextAdapter = {
  async resolve(input) {
    if (input.kind !== 'workspace_folder') {
      return { ok: false, reason: 'unsupported', status: 400, error: 'Unsupported workspace folder context' }
    }

    const base = await genericChatContextAdapter.resolve(input)
    if (!base.ok) return base

    const isWorkbenchDirectory = input.id.startsWith('workbench-directory:')
    const workbenchPath = typeof input.contextReference?.metadata?.path === 'string'
      ? clean(input.contextReference.metadata.path)
      : ''
    if (isWorkbenchDirectory && workbenchPath) {
      return fallbackForWorkbenchDirectory({
        id: input.id,
        workbenchPath,
        base: base.model,
      })
    }
    if (isWorkbenchDirectory) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const snap = await adminDb.collection(WORKSPACE_FOLDER_COLLECTION).doc(input.id).get()
    if (!snap.exists) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const folder = serializeWorkspaceFolder(snap.id, snap.data() ?? {})
    if (folder.deleted || folder.orgId !== base.model.context.orgId || !canReadWorkspaceFolder(folder, input.user)) {
      return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    }

    const href = `/admin/workspace/folders/${encodeURIComponent(folder.id)}`
    const actions = folderActions(folder, input.user.role)
    const state = stateForStatus(folder.syncState.status, folder.audit.conflictStatus, clean(folder.audit.riskLevel))
    const folderRelationships = await relationships(folder, input.user)
    const attention = attentionFor(folder, href, actions)
    const metrics = [
      { id: 'status', label: 'Sync status', value: titleCase(folder.syncState.status) },
      { id: 'source', label: 'Source', value: titleCase(folder.sourceOfTruth) },
      { id: 'visibility', label: 'Visibility', value: titleCase(folder.visibility) },
      { id: 'sync-mode', label: 'Sync mode', value: titleCase(folder.syncMode) },
      { id: 'risk', label: 'Risk', value: titleCase(clean(folder.audit.riskLevel) || 'Unknown') },
      { id: 'conflicts', label: 'Open conflicts', value: folder.syncState.conflictCount + '' },
    ].filter((metric) => metric.value.length > 0)

    const capabilities = [
      ...(input.user.role === 'admin' ? ['open', 'preview', 'sync', 'resync'] : ['open', 'preview']),
      ...(actions.length ? ['inline-actions'] : []),
      'permissions',
    ]

    return {
      ok: true,
      model: {
        context: {
          ...base.model.context,
          label: folder.name || base.model.context.label,
          href,
        },
        pulse: {
          label: 'Workspace folder',
          metrics,
          headline: clean([
            folder.description,
            folder.provider ? `Source: ${folder.provider}` : '',
            folder.drive.folderUrl || folder.paths.localPathHint ? `Path: ${clean(folder.drive.folderUrl || folder.paths.localPathHint, 180)}` : '',
          ].filter(Boolean).join(' · ')),
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
          id: 'folder',
          label: 'Workspace folder',
          items: [{
            id: folder.id,
            label: folder.name,
            state,
            detail: clean([
              folder.provider ? `Provider: ${folder.provider}` : '',
              folder.owner.id ? `Owner: ${folder.owner.id}` : '',
              folder.drive.folderId ? `Drive folder: ${folder.drive.folderId}` : '',
              folder.paths.vpsPath ? `VPS: ${folder.paths.vpsPath}` : '',
            ].filter(Boolean).join(' · ')),
            href,
            ...(actions.length > 0 ? { actions } : {}),
          }],
        }],
        artifacts: [],
        attention,
        activity: activityFor(folder),
        preview: {
          kind: 'summary',
          text: clean([folder.description, `Status: ${titleCase(folder.syncState.status)}`, `Owner: ${folder.owner.id || 'n/a'}`].filter(Boolean).join(' · ')),
          status: folder.syncState.status,
          version: folder.syncState.lastSyncedAt ?? folder.audit.lastReviewedAt ?? undefined,
        },
        ...(folderRelationships.length > 0 ? { relationships: folderRelationships } : {}),
        capabilities,
        asOf: new Date().toISOString(),
      },
    }
  },
}
