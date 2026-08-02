import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { canAccessConversation } from '@/lib/conversations/access'
import { getConversation } from '@/lib/conversations/conversations'
import {
  autoLinkProjectToConversationComputer,
  getProjectConversationComputerLinkStatus,
} from '@/lib/project-locations/auto-link-conversation-computer'
import { publicProjectLocationReplica } from '@/lib/project-locations/public'
import { getProjectForUser } from '@/lib/projects/access'
import { canProjectRole } from '@/lib/projects/collaboration'
import { projectLinkedToOrganization } from '@/lib/projects/organization-link'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ projectId: string }> }

/**
 * POST /api/v1/projects/:projectId/link-to-conversation
 *
 * Creates (or confirms) the project location replica on the computer bound to
 * a Messages conversation. Used by the project chat-context preview action
 * when a project is pinned but not yet linked to that chat's machine.
 *
 * Body: { conversationId: string, orgId?: string }
 */
export const POST = withAuth('client', async (req: NextRequest, user, ctx: Context) => {
  const { projectId } = await ctx.params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
  if (!conversationId) return apiError('conversationId is required', 400)

  const conversation = await getConversation(conversationId)
  if (!conversation || !canAccessConversation(user, conversation)) {
    return apiError('Conversation not found', 404)
  }

  const orgId = typeof body.orgId === 'string' && body.orgId.trim()
    ? body.orgId.trim()
    : conversation.orgId
  if (!orgId) return apiError('orgId is required', 400)
  if (!canAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (conversation.orgId !== orgId) return apiError('Conversation does not belong to this organisation', 403)

  const access = await getProjectForUser(projectId, user, orgId)
  if (!access.ok) return apiError(access.error, access.status)
  if (!await projectLinkedToOrganization({ projectId, project: access.doc.data() ?? {}, orgId })) {
    return apiError('Project is not linked to this organisation', 403)
  }
  if (!canProjectRole(access.projectAccess?.role ?? 'viewer', 'write')) {
    return apiError('Project write access required', 403)
  }

  const project = access.doc.data() ?? {}
  const projectFolderRelativePath = typeof project.projectFolderRelativePath === 'string'
    ? project.projectFolderRelativePath
    : null

  // Idempotent: if already linked, return the existing status without error.
  const existing = await getProjectConversationComputerLinkStatus({
    projectId,
    orgId,
    actorUserId: user.uid,
    workspaceContext: conversation.workspaceContext,
    projectFolderRelativePath,
  })
  if (existing.status === 'linked') {
    return apiSuccess({
      linked: true,
      alreadyLinked: true,
      locationId: existing.locationId,
      ...(existing.computerLabel ? { computerLabel: existing.computerLabel } : {}),
    })
  }
  if (existing.status === 'no_computer') {
    return apiError(
      existing.reason === 'runtime_not_linkable'
        ? 'This chat is not bound to a linkable computer'
        : 'This chat has no computer bound',
      409,
    )
  }

  const linkResult = await autoLinkProjectToConversationComputer({
    projectId,
    orgId,
    actorUserId: user.uid,
    workspaceContext: conversation.workspaceContext,
    projectFolderRelativePath,
  })

  if (!linkResult.linked) {
    const messageByReason: Record<string, string> = {
      conversation_has_no_computer: 'This chat has no computer bound',
      runtime_not_linkable: 'This chat is not bound to a linkable computer',
      computer_not_available_to_org: 'The chat computer is not available to this organisation',
      mapping_inactive: 'The workspace mapping for this computer is not active',
      invalid_relative_path: 'Project folder path is invalid',
      computer_unavailable: 'Computer unavailable',
      location_inactive: 'Project location is not active',
      location_forbidden: 'Project location is not available to this organisation',
      location_list_failed: 'Could not list project locations',
      link_failed: 'Failed to link project to computer',
    }
    return apiError(messageByReason[linkResult.reason] ?? 'Failed to link project to computer', 409, {
      reason: linkResult.reason,
    })
  }

  return apiSuccess({
    linked: true,
    alreadyLinked: false,
    locationId: linkResult.locationId,
    replica: publicProjectLocationReplica(linkResult.replica),
    // Agents should document linkage in the on-disk AGENTS.md after the
    // linked runtime creates/syncs the project folder.
    agentGuidance: {
      writeAgentsMd: true,
      document: [
        'project id and name',
        'linked computer / location id',
        'workspace id',
        'company / CRM links when present',
        'code roots / related folders',
        'related projects sharing the same on-disk path',
      ],
    },
  }, 201)
})
