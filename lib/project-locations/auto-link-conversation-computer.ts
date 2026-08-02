/**
 * Auto-link a project to the computer bound on a Messages conversation.
 *
 * Agents often create a project and pin it as chat context. Without a project
 * location replica on that computer, the next send fails with
 * "Project is not linked to this computer". This helper closes that gap.
 *
 * Soft-fails when the conversation has no computer, the computer is offline,
 * or linking is not available — callers must not fail project create/pin.
 */

import type { ConversationWorkspaceContext } from '@/lib/client-provisioning/workspace-context'
import { linkedDeviceProjectLocationId } from '@/lib/linked-computers/runtime-targets'
import { canonicalProjectRelativePath } from '@/lib/project-locations/model'
import {
  linkProjectLocation,
  listExecutionLocationsForWorkspace,
  ProjectLocationStoreError,
  type LinkProjectLocationInput,
  type ProjectLocationStoreOptions,
} from '@/lib/project-locations/store'
import type { ProjectLocationReplica } from '@/lib/project-locations/model'

export type AutoLinkProjectToConversationComputerInput = {
  projectId: string
  orgId: string
  actorUserId: string
  workspaceContext?: ConversationWorkspaceContext | null
  /** Optional override from the project document */
  projectFolderRelativePath?: string | null
}

export type AutoLinkProjectToConversationComputerResult =
  | { linked: true; replica: ProjectLocationReplica; locationId: string }
  | { linked: false; reason: string }

export type AutoLinkDependencies = {
  listExecutionLocationsForWorkspace?: typeof listExecutionLocationsForWorkspace
  linkProjectLocation?: (input: LinkProjectLocationInput, options?: ProjectLocationStoreOptions) => Promise<ProjectLocationReplica>
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Resolve the project execution location id for a conversation runtime target.
 * Supports native linked-device IDs and legacy runtime aliases on the location.
 */
export function resolveConversationComputerLocationId(
  runtimeTarget: string | undefined | null,
): string | null {
  const target = cleanString(runtimeTarget)
  if (!target || target === 'auto' || target === 'vps' || target === 'local') return null
  if (target.startsWith('linked-device:')) return target
  // Bare device id from some session payloads
  if (/^[A-Za-z0-9_-]{1,128}$/.test(target)) {
    try {
      return linkedDeviceProjectLocationId(target)
    } catch {
      return null
    }
  }
  return target
}

export async function autoLinkProjectToConversationComputer(
  input: AutoLinkProjectToConversationComputerInput,
  dependencies: AutoLinkDependencies = {},
): Promise<AutoLinkProjectToConversationComputerResult> {
  const workspaceId = cleanString(input.workspaceContext?.workspaceId)
  const runtimeTarget = cleanString(input.workspaceContext?.runtimeTarget)
  if (!workspaceId || !runtimeTarget) {
    return { linked: false, reason: 'conversation_has_no_computer' }
  }

  const locationIdHint = resolveConversationComputerLocationId(runtimeTarget)
  if (!locationIdHint) {
    return { linked: false, reason: 'runtime_not_linkable' }
  }

  const listLocations = dependencies.listExecutionLocationsForWorkspace ?? listExecutionLocationsForWorkspace
  const link = dependencies.linkProjectLocation ?? linkProjectLocation

  let locations
  try {
    locations = await listLocations(input.orgId, workspaceId, input.actorUserId)
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[auto-link-project-computer] list locations failed', error)
    }
    return { linked: false, reason: 'location_list_failed' }
  }

  const location = locations.find((candidate) => (
    candidate.locationId === locationIdHint
    || candidate.runtimeTargetId === locationIdHint
    || candidate.runtimeTargetId === runtimeTarget
    || candidate.legacyCompatibilityTargetId === runtimeTarget
    || candidate.legacyCompatibilityTargetId === locationIdHint
  ))
  if (!location) {
    return { linked: false, reason: 'computer_not_available_to_org' }
  }

  const mapping = location.mappings.find((candidate) => (
    candidate.orgId === input.orgId
    && candidate.workspaceId === workspaceId
    && candidate.status === 'active'
  ))
  if (!mapping) {
    return { linked: false, reason: 'mapping_inactive' }
  }

  let relativePath: string
  try {
    relativePath = canonicalProjectRelativePath(
      input.projectId,
      cleanString(input.projectFolderRelativePath) || undefined,
    )
  } catch {
    return { linked: false, reason: 'invalid_relative_path' }
  }

  try {
    const replica = await link({
      projectId: input.projectId,
      orgId: input.orgId,
      workspaceId,
      locationId: location.locationId,
      mappingId: mapping.mappingId,
      actorUserId: input.actorUserId,
      relativePath,
      isCanonical: true,
    })
    return { linked: true, replica, locationId: location.locationId }
  } catch (error) {
    if (error instanceof ProjectLocationStoreError) {
      return { linked: false, reason: error.code }
    }
    if (process.env.NODE_ENV !== 'test') {
      console.error('[auto-link-project-computer] link failed', error)
    }
    return { linked: false, reason: 'link_failed' }
  }
}

export function conversationIdFromProjectCreateBody(body: Record<string, unknown>): string | null {
  const direct = cleanString(body.conversationId) || cleanString(body.sourceConversationId)
  if (direct) return direct
  const origin = body.conversationOrigin
  if (origin && typeof origin === 'object' && !Array.isArray(origin)) {
    const conversationId = cleanString((origin as Record<string, unknown>).conversationId)
    if (conversationId) return conversationId
  }
  return null
}
