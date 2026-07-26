import type { ApiUser } from '@/lib/api/types'
import { authorizeConversationProject, canAccessConversation } from '@/lib/conversations/access'
import { getConversation } from '@/lib/conversations/conversations'
import type { Conversation } from '@/lib/conversations/types'
import {
  authorizeLinkedComputerDispatch,
  linkedRuntimeUpdateRequired,
  type AuthorizedLinkedComputerDispatch,
} from '@/lib/linked-computers/runtime-targets'
import { requireProjectRuntimeReplica } from '@/lib/project-locations/runtime-binding'
import type { WorkbenchBrowserSession } from './browser-sessions'
import { sanitizeWorkbenchRelativePath, type WorkbenchJob } from './jobs'
import type { WorkbenchSession } from './sessions'
import type { WorkbenchTunnelSession } from './tunnel-sessions'

export class WorkbenchAuthorizationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'WorkbenchAuthorizationError'
  }
}

export interface AuthorizedWorkbenchContext {
  conversation: Conversation
  projectId: string | null
  projectReplicaId?: string
  relativeFolder: string
  binding: AuthorizedLinkedComputerDispatch
}

interface AuthorizationDependencies {
  getConversation?: typeof getConversation
  canAccessConversation?: typeof canAccessConversation
  authorizeConversationProject?: typeof authorizeConversationProject
  authorizeLinkedComputerDispatch?: typeof authorizeLinkedComputerDispatch
  requireProjectRuntimeReplica?: typeof requireProjectRuntimeReplica
}

export const WORKBENCH_MINIMUM_RUNTIME_VERSION = '1.1.8'

export function workbenchRuntimeUpdateRequired(version: string): boolean {
  return linkedRuntimeUpdateRequired(version, WORKBENCH_MINIMUM_RUNTIME_VERSION)
}

/**
 * Resolve every durable execution identifier from the conversation. Browser
 * supplied org/device/workspace/mapping IDs are intentionally not accepted.
 */
export async function authorizeWorkbenchConversation(
  user: ApiUser,
  conversationId: string,
  dependencies: AuthorizationDependencies = {},
): Promise<AuthorizedWorkbenchContext> {
  const conversation = await (dependencies.getConversation ?? getConversation)(conversationId)
  if (!conversation) throw new WorkbenchAuthorizationError('Conversation not found', 404)
  if (!(dependencies.canAccessConversation ?? canAccessConversation)(user, conversation)) {
    throw new WorkbenchAuthorizationError('Forbidden', 403)
  }
  if (user.role !== 'admin' && user.role !== 'client') {
    throw new WorkbenchAuthorizationError('Workbench jobs require a human user', 403)
  }
  const projectAuthorization = await (dependencies.authorizeConversationProject ?? authorizeConversationProject)(user, conversation)
  if (!projectAuthorization.ok) {
    throw new WorkbenchAuthorizationError(projectAuthorization.error, projectAuthorization.status)
  }

  const workspace = conversation.workspaceContext
  const workspaceId = workspace?.workspaceId?.trim() ?? ''
  const runtimeTargetId = workspace?.runtimeTarget?.trim() ?? ''
  const mappingId = workspace?.mappingId?.trim() ?? ''
  if (!workspace || workspace.orgId !== conversation.orgId || !workspaceId || !runtimeTargetId || !mappingId) {
    throw new WorkbenchAuthorizationError('This conversation is not bound to a linked computer workspace', 409)
  }

  let binding: AuthorizedLinkedComputerDispatch
  try {
    binding = await (dependencies.authorizeLinkedComputerDispatch ?? authorizeLinkedComputerDispatch)({
      userId: user.uid,
      orgId: conversation.orgId,
      workspaceId,
      runtimeTargetId,
      mappingId,
    })
  } catch {
    throw new WorkbenchAuthorizationError('Computer unavailable', 409)
  }
  if (binding.workspaceId !== workspaceId || binding.mappingId !== mappingId) {
    throw new WorkbenchAuthorizationError('Computer workspace binding changed', 409)
  }
  if (workbenchRuntimeUpdateRequired(binding.runtimeVersion)) {
    throw new WorkbenchAuthorizationError(
      `Computer runtime update required for Workbench (minimum ${WORKBENCH_MINIMUM_RUNTIME_VERSION})`,
      409,
    )
  }

  if (projectAuthorization.projectId) {
    try {
      const replica = await (dependencies.requireProjectRuntimeReplica ?? requireProjectRuntimeReplica)({
        projectId: projectAuthorization.projectId,
        orgId: conversation.orgId,
        workspaceId,
        actorUserId: user.uid,
        runtime: { kind: 'linked-computer', deviceId: binding.deviceId },
      })
      const relativeFolder = sanitizeWorkbenchRelativePath(replica.relativePath, { allowRoot: true })
      if (!relativeFolder || replica.mappingId !== binding.mappingId) {
        throw new Error('Project is not linked to this computer')
      }
      return {
        conversation,
        projectId: projectAuthorization.projectId,
        projectReplicaId: replica.replicaId,
        relativeFolder,
        binding,
      }
    } catch {
      throw new WorkbenchAuthorizationError('Project is not linked to this computer', 409)
    }
  }

  const relativeFolder = sanitizeWorkbenchRelativePath(workspace.folderRelativePath || '.', { allowRoot: true })
  if (!relativeFolder) throw new WorkbenchAuthorizationError('Conversation workspace folder is invalid', 409)
  return { conversation, projectId: null, relativeFolder, binding }
}

/** Exact durable job binding used by browser poll and approval routes. */
export function isWorkbenchJobOwnedByContext(
  job: WorkbenchJob,
  user: ApiUser,
  conversationId: string,
  authorization: AuthorizedWorkbenchContext,
): boolean {
  return job.conversationId === conversationId
    && job.conversationId === authorization.conversation.id
    && job.orgId === authorization.conversation.orgId
    && job.actorUserId === user.uid
    && job.deviceId === authorization.binding.deviceId
    && job.runtimeTargetId === authorization.binding.runtimeTargetId
    && job.credentialVersion === authorization.binding.credentialVersion
    && job.workspaceId === authorization.binding.workspaceId
    && job.mappingId === authorization.binding.mappingId
    && (job.projectId ?? null) === authorization.projectId
    && (job.projectReplicaId ?? null) === (authorization.projectReplicaId ?? null)
    && job.relativeFolder === authorization.relativeFolder
}

/** Exact durable session binding used by the browser session poll/stdin/resize/kill routes. */
export function isWorkbenchSessionOwnedByContext(
  session: WorkbenchSession,
  user: ApiUser,
  conversationId: string,
  authorization: AuthorizedWorkbenchContext,
): boolean {
  return session.conversationId === conversationId
    && session.conversationId === authorization.conversation.id
    && session.orgId === authorization.conversation.orgId
    && session.actorUserId === user.uid
    && session.deviceId === authorization.binding.deviceId
    && session.runtimeTargetId === authorization.binding.runtimeTargetId
    && session.credentialVersion === authorization.binding.credentialVersion
    && session.workspaceId === authorization.binding.workspaceId
    && session.mappingId === authorization.binding.mappingId
    && (session.projectId ?? null) === authorization.projectId
    && (session.projectReplicaId ?? null) === (authorization.projectReplicaId ?? null)
    && session.relativeFolder === authorization.relativeFolder
}

/** Exact durable binding used by the browser control session create/poll/approve/navigate/capture/kill routes. */
export function isWorkbenchBrowserSessionOwnedByContext(
  session: WorkbenchBrowserSession,
  user: ApiUser,
  conversationId: string,
  authorization: AuthorizedWorkbenchContext,
): boolean {
  return session.conversationId === conversationId
    && session.conversationId === authorization.conversation.id
    && session.orgId === authorization.conversation.orgId
    && session.actorUserId === user.uid
    && session.deviceId === authorization.binding.deviceId
    && session.runtimeTargetId === authorization.binding.runtimeTargetId
    && session.credentialVersion === authorization.binding.credentialVersion
    && session.workspaceId === authorization.binding.workspaceId
    && session.mappingId === authorization.binding.mappingId
    && (session.projectId ?? null) === authorization.projectId
    && (session.projectReplicaId ?? null) === (authorization.projectReplicaId ?? null)
    && session.relativeFolder === authorization.relativeFolder
}

/** Exact durable binding used by the browser tunnel create/poll/approve/kill routes. */
export function isWorkbenchTunnelSessionOwnedByContext(
  session: WorkbenchTunnelSession,
  user: ApiUser,
  conversationId: string,
  authorization: AuthorizedWorkbenchContext,
): boolean {
  return session.conversationId === conversationId
    && session.conversationId === authorization.conversation.id
    && session.orgId === authorization.conversation.orgId
    && session.actorUserId === user.uid
    && session.deviceId === authorization.binding.deviceId
    && session.runtimeTargetId === authorization.binding.runtimeTargetId
    && session.credentialVersion === authorization.binding.credentialVersion
    && session.workspaceId === authorization.binding.workspaceId
    && session.mappingId === authorization.binding.mappingId
    && (session.projectId ?? null) === authorization.projectId
    && (session.projectReplicaId ?? null) === (authorization.projectReplicaId ?? null)
    && session.relativeFolder === authorization.relativeFolder
}
