import { createHash } from 'node:crypto'
import type { ApiUser } from '@/lib/api/types'
import type { ContextReference, ContextReferenceSeed } from '@/lib/context-references/types'
import { authorizeWorkbenchConversation, type AuthorizedWorkbenchContext } from './authorization'
import { sanitizeWorkbenchRelativePath } from './jobs'

export const WORKBENCH_PATH_CONTEXT_KIND = 'workbench_path'

type WorkbenchPathKind = 'file' | 'directory'

function referenceId(kind: WorkbenchPathKind, binding: AuthorizedWorkbenchContext, path: string): string {
  const digest = createHash('sha256')
    .update([
      binding.conversation.id,
      binding.binding.deviceId,
      binding.binding.workspaceId,
      binding.binding.mappingId,
      binding.rootBindingId ?? '',
      kind,
      path,
    ].join('\n'))
    .digest('base64url')
  return `workbench-${kind}:${digest}`
}

export function createWorkbenchPathContextReference(
  binding: AuthorizedWorkbenchContext,
  entry: { path: string; type: WorkbenchPathKind },
): ContextReference {
  const safePath = sanitizeWorkbenchRelativePath(entry.path)
  if (!safePath) throw new Error('workbench: invalid context path')
  const type = entry.type === 'file' ? 'file' : 'workspace_folder'
  return {
    type,
    id: referenceId(entry.type, binding, safePath),
    orgId: binding.conversation.orgId,
    label: safePath,
    origin: 'mention',
    summary: entry.type === 'file'
      ? `Linked Workbench file: ${safePath}`
      : `Linked Workbench folder: ${safePath}`,
    metadata: {
      contextKind: WORKBENCH_PATH_CONTEXT_KIND,
      path: safePath,
      entryType: entry.type,
      conversationId: binding.conversation.id,
      deviceId: binding.binding.deviceId,
      workspaceId: binding.binding.workspaceId,
      mappingId: binding.binding.mappingId,
      rootBindingId: binding.rootBindingId ?? '',
    },
    resolvedAt: new Date().toISOString(),
  }
}

export function isWorkbenchPathContextSeed(seed: ContextReferenceSeed): boolean {
  return seed.metadata?.contextKind === WORKBENCH_PATH_CONTEXT_KIND
}

export async function resolveWorkbenchPathContextReference(
  seed: ContextReferenceSeed,
  user: ApiUser,
  defaultOrgId: string | undefined,
  conversationId: string | undefined,
): Promise<ContextReference | null> {
  if (!isWorkbenchPathContextSeed(seed) || !conversationId || seed.orgId !== defaultOrgId) return null
  const metadata = seed.metadata ?? {}
  const path = typeof metadata.path === 'string' ? sanitizeWorkbenchRelativePath(metadata.path) : null
  const entryType = metadata.entryType === 'file' || metadata.entryType === 'directory' ? metadata.entryType : null
  if (!path || !entryType || metadata.conversationId !== conversationId) return null
  if ((entryType === 'file' && seed.type !== 'file')
    || (entryType === 'directory' && seed.type !== 'workspace_folder')) return null

  const binding = await authorizeWorkbenchConversation(user, conversationId)
  if (binding.conversation.orgId !== defaultOrgId
    || metadata.deviceId !== binding.binding.deviceId
    || metadata.workspaceId !== binding.binding.workspaceId
    || metadata.mappingId !== binding.binding.mappingId
    || String(metadata.rootBindingId ?? '') !== (binding.rootBindingId ?? '')
    || seed.id !== referenceId(entryType, binding, path)) return null

  return {
    ...createWorkbenchPathContextReference(binding, { path, type: entryType }),
    origin: seed.origin ?? 'mention',
  }
}
