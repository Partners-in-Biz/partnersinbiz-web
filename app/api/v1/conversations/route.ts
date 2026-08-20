/**
 * POST /api/v1/conversations — create a new conversation
 * GET  /api/v1/conversations?orgId=... — list conversations for the caller
 *
 * Auth: admin or client
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { runWithFirestoreReadAudit } from '@/lib/firebase/read-audit'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { ensureCompanyCoworkFolderWithinBudget } from '@/lib/conversations/create-resilience'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { isValidAgentId } from '@/lib/agents/types'
import { canStartLinkedAgent } from '@/lib/agents/org-agent-policy'
import {
  createConversation,
  listConversations,
  orgChatConfigDoc,
  resolveVisibleAgents,
} from '@/lib/conversations/conversations'
import { getOrgChatVisibilityPolicy } from '@/lib/conversations/chat-config'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { sanitizeContextReferenceSeeds } from '@/lib/context-references/types'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { assertUserCanPerformOrganizationModuleAction } from '@/lib/organizations/module-policy-access'
import { resolveConversationWorkspaceContext } from '@/lib/client-provisioning/workspace-context'
import {
  authorizeWorkspaceRuntime,
  workspaceRuntimeSupportsOrganizationSharing,
} from '@/lib/workspaces/runtime-authorization'
import type { AuthorizedWorkspaceRuntime } from '@/lib/workspaces/runtime-authorization'
import {
  projectRuntimeReplicaApiError,
  requireProjectRuntimeReplica,
} from '@/lib/project-locations/runtime-binding'
import { getProjectForUser } from '@/lib/projects/access'
import { projectLinkedToOrganization } from '@/lib/projects/organization-link'
import { getConversationCompanyForUser } from '@/lib/companies/conversation-access'
import { publicConversationView } from '@/lib/conversations/access'
import { organizationMemberUids } from '@/lib/conversations/participant-access'
import { resolveConversationDispatchAgentId } from '@/lib/conversations/dispatch-agent'
import { memberCanUseAgentOnRuntime } from '@/lib/orgMembers/access-policy'
import { loadOrgMemberAccessPolicy } from '@/lib/orgMembers/org-access-policy'
import {
  parseBotChannelKind,
  parseBotInboxMeta,
  usesBotComputerIsolation,
} from '@/lib/messages/bot-channel'
import {
  isolatedBotBrowserProfileId,
  joinIsolatedBotFolder,
} from '@/lib/messages/bot-computer-isolation'
import type { AgentId, Participant, Conversation, ConversationScope } from '@/lib/conversations/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

const VALID_SCOPES: ConversationScope[] = ['general', 'project', 'workspace', 'task', 'campaign', 'company', 'contact']
const isPlatformWorkspace = (orgId: string) => orgId === PIB_PLATFORM_ORG_ID

export const POST = withAuth(
  'client',
  withIdempotency(async (req: NextRequest, user: ApiUser) => {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

    const requestedOrgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : null

    // Scope check. Client callers may omit orgId and use their selected active workspace;
    // admin/AI callers remain explicit through resolveOrgScope.
    const scope = resolveOrgScope(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    if (user.role === 'ai' && (!user.orgId || user.orgId !== scope.orgId)) {
      return apiError('AI credentials are not authorised for this organisation', 403)
    }
    const startAccess = await assertUserCanPerformOrganizationModuleAction(
      user,
      scope.orgId,
      'messages',
      'start',
      'Conversation starts are disabled for your organisation role',
    )
    if (!startAccess.ok) return apiError(startAccess.error, startAccess.status)
    const chatPolicy = await getOrgChatVisibilityPolicy(scope.orgId)

    // Participants validation
    if (!Array.isArray(body.participants)) {
      return apiError('participants must be an array', 400)
    }

    const callerRole: 'admin' | 'client' =
      user.role === 'admin' || user.role === 'ai' ? 'admin' : 'client'
    const requestedRuntimeTargetForAgentGrant = typeof body.runtimeTarget === 'string' && body.runtimeTarget.trim()
      ? body.runtimeTarget.trim()
      : null
    // Auth hydrates memberAccessPolicy for activeOrgId only — load the policy
    // for the conversation org when evaluating Team agent grants.
    const scopedAccessPolicy = (await loadOrgMemberAccessPolicy(scope.orgId, user.uid))
      ?? user.memberAccessPolicy
      ?? null
    const membershipDoc = await adminDb.collection('orgMembers').doc(`${scope.orgId}_${user.uid}`).get()
    const memberRole = membershipDoc.data()?.role
    const orgManager = user.role === 'admin' || memberRole === 'owner' || memberRole === 'admin'

    // Load visible agents for the caller's role
    const configDoc = await orgChatConfigDoc(scope.orgId).get()
    const config = configDoc.exists
      ? (configDoc.data() as { visibleAgents?: { admin?: AgentId[]; client?: AgentId[] } })
      : null
    const memberProfile = {
      department: membershipDoc.exists && typeof membershipDoc.data()?.department === 'string'
        ? membershipDoc.data()!.department
        : null,
      jobTitle: membershipDoc.exists && typeof membershipDoc.data()?.jobTitle === 'string'
        ? membershipDoc.data()!.jobTitle
        : null,
    }
    const allowedAgentIds = new Set<AgentId>(resolveVisibleAgents(config, callerRole, memberProfile))
    const orgMemberUids = new Set<string>()
    if (callerRole === 'client' || !isPlatformWorkspace(scope.orgId)) {
      const canonicalMemberUids = await organizationMemberUids(scope.orgId)
      canonicalMemberUids.forEach((uid) => orgMemberUids.add(uid))
    }
    const platformAdminUids = new Set<string>()
    if (callerRole === 'client') {
      const adminsSnap = await adminDb.collection('users').where('role', '==', 'admin').get()
      adminsSnap.docs.forEach((doc) => {
        const data = doc.data()
        const allowedOrgIds = Array.isArray(data.allowedOrgIds)
          ? data.allowedOrgIds.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
          : undefined
        if (isSuperAdmin({ uid: doc.id, role: data.role as 'admin', allowedOrgIds })) {
          platformAdminUids.add(doc.id)
        }
      })
    }

    // Validate + normalise participant list
    const participants: Participant[] = []
    const seenUids = new Set<string>()
    const seenAgents = new Set<AgentId>()

    for (const raw of body.participants as unknown[]) {
      if (!raw || typeof raw !== 'object') return apiError('Each participant must be an object', 400)
      const p = raw as Record<string, unknown>

      if (p.kind === 'user') {
        const uid = typeof p.uid === 'string' ? p.uid.trim() : ''
        if (!uid) return apiError('User participant must have a uid', 400)
        if (seenUids.has(uid)) continue // deduplicate
        seenUids.add(uid)

        // Clients may start conversations with their team or platform admins.
        if (callerRole === 'client' && uid !== user.uid) {
          if (!orgMemberUids.has(uid) && !platformAdminUids.has(uid)) {
            return apiError(`User ${uid} is not a member of this organisation`, 400)
          }
        }

        const userDoc = await adminDb.collection('users').doc(uid).get()
        const userData = userDoc.data() ?? {}
        const userRole: 'admin' | 'client' =
          userData.role === 'admin' ? 'admin' : 'client'
        const isPlatformAdmin = platformAdminUids.has(uid)
        if (callerRole === 'client' && uid !== user.uid && userRole === 'admin'
          && !isPlatformAdmin && !chatPolicy.enableClientToAdminChat) {
          return apiError(`Client cannot create chats with admins in this organisation`, 403)
        }
        if (callerRole === 'client' && uid !== user.uid && isPlatformAdmin
          && !chatPolicy.enableClientToPiBTeamChat) {
          return apiError('Client cannot create chats with PiB team in this organisation', 403)
        }
        if (isPlatformWorkspace(scope.orgId) && callerRole === 'admin' && userRole !== 'admin') {
          return apiError(`User ${uid} is not a platform admin`, 400)
        }

        participants.push({
          kind: 'user',
          uid,
          role: userRole,
          displayName: userData.displayName as string | undefined,
          email: userData.email as string | undefined,
        })
      } else if (p.kind === 'agent') {
        const agentId = p.agentId as AgentId | undefined
        if (!isValidAgentId(agentId)) {
          return apiError(`Invalid agent agentId: ${agentId}`, 400)
        }
        let delegatedAgentAccess = callerRole === 'client'
          && Boolean(scopedAccessPolicy)
          && memberCanUseAgentOnRuntime(scopedAccessPolicy, requestedRuntimeTargetForAgentGrant, agentId)
        // Pip remains the ordinary member-facing assistant. Specialist profiles
        // require an explicit per-runtime Team grant.
        const baselineMemberAssistant = callerRole === 'client' && agentId === 'pip'
        if (seenAgents.has(agentId)) continue

        // Look up agent name from agent_team
        const agentDoc = await adminDb.collection('agent_team').doc(agentId).get()
        const agentData = agentDoc.data()
        if (!agentDoc.exists || !agentData?.enabled) {
          return apiError(`Agent ${agentId} is not available`, 400)
        }
        const scopedOrgId = typeof agentData.scopeOrgId === 'string' ? agentData.scopeOrgId : null
        if (scopedOrgId && scopedOrgId !== scope.orgId) {
          return apiError(`Agent ${agentId} is not available in this organisation`, 403)
        }
        if (agentData.provisioningMode === 'linked_device' && agentData.provisioningStatus !== 'ready') {
          return apiError(`Agent ${agentId} is still provisioning`, 409)
        }
        let selectedLinkedDevice: Record<string, unknown> | null = null
        if (agentData.provisioningMode === 'linked_device') {
          const targetDeviceId = requestedRuntimeTargetForAgentGrant?.startsWith('linked-device:')
            ? requestedRuntimeTargetForAgentGrant.slice('linked-device:'.length)
            : requestedRuntimeTargetForAgentGrant
          if (!targetDeviceId) return apiError('Select a computer where this agent is installed', 409)
          const targetDevice = await adminDb.collection('linked_devices').doc(targetDeviceId).get()
          selectedLinkedDevice = targetDevice.exists ? targetDevice.data() ?? null : null
          const availableAgentIds = Array.isArray(selectedLinkedDevice?.availableAgentIds)
            ? selectedLinkedDevice.availableAgentIds as unknown[]
            : []
          const credentialReadyAgentIds = Array.isArray(selectedLinkedDevice?.credentialReadyAgentIds)
            ? selectedLinkedDevice.credentialReadyAgentIds as unknown[]
            : []
          if (!availableAgentIds.includes(agentId) || !credentialReadyAgentIds.includes(agentId)) {
            return apiError(`Agent ${agentId} is not ready on the selected computer`, 409)
          }
        }
        const managesOrgLinkedAgent = Boolean(
          orgManager
          && agentData.provisioningMode === 'linked_device'
          && agentData.accessScope === 'organization'
          && scopedOrgId === scope.orgId,
        )
        const isClientVisibleAgent = callerRole === 'client' && allowedAgentIds.has(agentId)
        const isOrgScopedManagerAgent = callerRole === 'client'
          && orgManager
          && Boolean(scopedOrgId)
          && agentData.accessScope !== 'personal'
        const linkedAgentAccess = agentData.provisioningMode === 'linked_device'
          ? (
              canStartLinkedAgent({
                accessScope: agentData.accessScope,
                ownerUserId: agentData.ownerUserId,
                actorUserId: user.uid,
                callerRole,
                selectedDeviceOwnerUserId: typeof selectedLinkedDevice?.ownerUserId === 'string'
                  ? selectedLinkedDevice.ownerUserId
                  : undefined,
                explicitlyGranted: delegatedAgentAccess,
              })
              || managesOrgLinkedAgent
            )
          : false
        delegatedAgentAccess = delegatedAgentAccess || linkedAgentAccess
        if (agentData.provisioningMode === 'linked_device' && !linkedAgentAccess) {
          return apiError('You are not allowed to use that agent on the selected computer', 403)
        }
        if (
          callerRole === 'client'
          && !baselineMemberAssistant
          && !delegatedAgentAccess
          && !isClientVisibleAgent
          && !isOrgScopedManagerAgent
          && agentData.provisioningMode !== 'linked_device'
        ) {
          return apiError('This member is not allowed to use that agent on the selected computer', 403)
        }
        if (callerRole === 'client' && !delegatedAgentAccess && !isClientVisibleAgent && !isOrgScopedManagerAgent) {
          return apiError(`Agent ${agentId} is not visible to your role`, 403)
        }

        seenAgents.add(agentId)
        participants.push({
          kind: 'agent',
          agentId,
          name: agentData.name as string,
        })
      } else {
        return apiError(`Unknown participant kind: ${p.kind}`, 400)
      }
    }

    // Auto-add caller to participants if not already included
    if (!seenUids.has(user.uid)) {
      const userDoc = await adminDb.collection('users').doc(user.uid).get()
      const userData = userDoc.data() ?? {}
      participants.unshift({
        kind: 'user',
        uid: user.uid,
        role: callerRole,
        displayName: userData.displayName as string | undefined,
        email: userData.email as string | undefined,
      })
    }

    const channelKind = parseBotChannelKind(body.channelKind)
    let botInbox = parseBotInboxMeta(body.botInbox)
    if (channelKind === 'bot_inbox') {
      const agentParticipants = participants.filter((participant): participant is Extract<Participant, { kind: 'agent' }> => participant.kind === 'agent')
      if (!botInbox) {
        if (agentParticipants.length !== 2) {
          return apiError('Bot inbox needs two different Bots', 400)
        }
        const parentConversationId = typeof body.parentConversationId === 'string' ? body.parentConversationId.trim() : ''
        botInbox = {
          fromAgentId: agentParticipants[1].agentId,
          toAgentId: agentParticipants[0].agentId,
          status: 'open',
          ...(parentConversationId ? { parentConversationId } : {}),
        }
      }
      if (!botInbox) return apiError('Bot inbox needs two different Bots', 400)
      const inbox = botInbox
      const hasFrom = agentParticipants.some((participant) => participant.agentId === inbox.fromAgentId)
      const hasTo = agentParticipants.some((participant) => participant.agentId === inbox.toAgentId)
      if (!hasFrom || !hasTo || inbox.fromAgentId === inbox.toAgentId) {
        return apiError('Bot inbox participants must include both Bots', 400)
      }
      const humans = participants.filter((participant) => participant.kind === 'user')
      const toParticipant = agentParticipants.find((participant) => participant.agentId === inbox.toAgentId)!
      const fromParticipant = agentParticipants.find((participant) => participant.agentId === inbox.fromAgentId)!
      const extras = agentParticipants.filter((participant) => (
        participant.agentId !== inbox.toAgentId && participant.agentId !== inbox.fromAgentId
      ))
      participants.splice(0, participants.length, ...humans, toParticipant, fromParticipant, ...extras)
    }

    let orchestration: Conversation['orchestration']
    const selectedAgentIds = Array.from(seenAgents)
    const skipPipOrchestrator = channelKind === 'bot_inbox'
    if (
      !skipPipOrchestrator &&
      callerRole === 'admin' &&
      selectedAgentIds.length > 1 &&
      !seenAgents.has('pip') &&
      allowedAgentIds.has('pip')
    ) {
      const pipDoc = await adminDb.collection('agent_team').doc('pip').get()
      const pipData = pipDoc.data()
      if (pipDoc.exists && pipData?.enabled) {
        seenAgents.add('pip')
        participants.push({
          kind: 'agent',
          agentId: 'pip',
          name: pipData.name as string,
        })
      }
    }

    if (!skipPipOrchestrator && callerRole === 'admin' && selectedAgentIds.length > 1) {
      orchestration = {
        mode: 'pip-orchestrator',
        dispatcherAgentId: 'pip',
        requestedAgentIds: selectedAgentIds,
      }
    }
    const dispatchAgentId = await resolveConversationDispatchAgentId({
      participantAgentIds: Array.from(seenAgents),
      orchestration,
    })

    // Optional fields
    const title = typeof body.title === 'string' ? body.title.trim() : undefined
    const rawScope = body.scope
    const convScope: ConversationScope | undefined =
      typeof rawScope === 'string' && VALID_SCOPES.includes(rawScope as ConversationScope)
        ? (rawScope as ConversationScope)
        : undefined
    const scopeRefId = typeof body.scopeRefId === 'string' ? body.scopeRefId.trim() : undefined
    const requestedWorkspaceId = typeof body.workspaceId === 'string' && body.workspaceId.trim()
      ? body.workspaceId.trim()
      : convScope === 'workspace' && scopeRefId
        ? scopeRefId
        : undefined
    const runtimeTarget = typeof body.runtimeTarget === 'string' && body.runtimeTarget.trim()
      ? body.runtimeTarget.trim()
      : undefined
    const requestedMappingId = typeof body.mappingId === 'string' && body.mappingId.trim()
      ? body.mappingId.trim()
      : undefined
    if (requestedMappingId && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestedMappingId)) {
      return apiError('mappingId is invalid', 400)
    }
    const shareMode = body.shareMode === 'shared' || body.shareMode === 'org' || body.shareMode === 'private'
      ? body.shareMode
      : 'private'
    if (convScope === 'workspace' && shareMode === 'private') {
      const additionalHuman = participants.find((participant) => participant.kind === 'user' && participant.uid !== user.uid)
      if (additionalHuman) return apiError('Private Workspace conversations cannot include other human participants', 400)
    }
    if (convScope === 'workspace' && !requestedWorkspaceId) {
      return apiError('workspaceId is required for workspace conversations', 400)
    }
    let projectName: string | undefined
    let projectFolderRelativePath: string | undefined
    let companyId: string | undefined
    let companyName: string | undefined
    let companyDomain: string | undefined
    let companyLinkedOrgId: string | undefined
    if (convScope === 'project') {
      if (!scopeRefId) return apiError('scopeRefId is required for project conversations', 400)
      if (!requestedWorkspaceId || !runtimeTarget) {
        return apiError('workspaceId and runtimeTarget are required for project conversations', 400)
      }
      const projectAccess = await getProjectForUser(scopeRefId, user, scope.orgId)
      if (!projectAccess.ok) return apiError(projectAccess.error, projectAccess.status)
      const projectData = projectAccess.doc.data() ?? {}
      if (!await projectLinkedToOrganization({ projectId: scopeRefId, project: projectData, orgId: scope.orgId })) {
        return apiError('Project is outside this organisation', 403)
      }
      projectName = typeof projectData.name === 'string' ? projectData.name.trim() : undefined
    }
    if (convScope === 'company') {
      if (!scopeRefId) return apiError('scopeRefId is required for company conversations', 400)
      if (!requestedWorkspaceId || !runtimeTarget) {
        return apiError('workspaceId and runtimeTarget are required for company conversations', 400)
      }
      const company = await getConversationCompanyForUser(scopeRefId, scope.orgId, user)
      if (!company) return apiError('Company not found', 404)
      companyId = company.id
      companyName = company.name
      companyDomain = typeof company.data.domain === 'string' && company.data.domain.trim()
        ? company.data.domain.trim()
        : typeof company.data.website === 'string' && company.data.website.trim()
          ? company.data.website.trim()
          : undefined
      companyLinkedOrgId = typeof company.data.linkedOrgId === 'string' && company.data.linkedOrgId.trim()
        ? company.data.linkedOrgId.trim()
        : undefined
    }
    const shouldBindWorkspace = convScope === 'workspace' || convScope === 'company'
      || convScope === 'project' || Boolean(requestedWorkspaceId)
    let runtimeLabel: string | undefined
    let authorizedWorkspaceRuntime: AuthorizedWorkspaceRuntime | null = null
    if (shouldBindWorkspace && runtimeTarget) {
      if (!requestedWorkspaceId) return apiError('workspaceId is required for computer dispatch', 400)
      try {
        authorizedWorkspaceRuntime = await authorizeWorkspaceRuntime({
          userId: user.uid,
          orgId: scope.orgId,
          workspaceId: requestedWorkspaceId,
          runtimeTargetId: runtimeTarget,
          ...(requestedMappingId ? { mappingId: requestedMappingId } : {}),
          ...(dispatchAgentId ? { agentId: dispatchAgentId } : {}),
        })
        runtimeLabel = authorizedWorkspaceRuntime.machineLabel
        if (requestedMappingId && authorizedWorkspaceRuntime.kind === 'linked-computer'
          && authorizedWorkspaceRuntime.mappingId !== requestedMappingId) {
          return apiError('Selected mapped folder is not authorized on this computer', 400)
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Computer unavailable') {
          return apiError('Computer unavailable', 409)
        }
        return apiError('Computer is unavailable or not authorized', 400)
      }
    }
    if ((shareMode === 'org' || shareMode === 'shared') && authorizedWorkspaceRuntime
      && !workspaceRuntimeSupportsOrganizationSharing(authorizedWorkspaceRuntime)) {
      return apiError(
        shareMode === 'shared'
          ? 'Shared sessions require an organisation-available computer'
          : 'Organisation-shared sessions require an organisation-available computer',
        400,
      )
    }
    if (convScope === 'project' && scopeRefId && requestedWorkspaceId && authorizedWorkspaceRuntime) {
      try {
        const projectReplica = await requireProjectRuntimeReplica({
          projectId: scopeRefId,
          orgId: scope.orgId,
          workspaceId: requestedWorkspaceId,
          actorUserId: user.uid,
          runtime: authorizedWorkspaceRuntime,
        })
        projectFolderRelativePath = projectReplica.relativePath
      } catch (error) {
        const mapped = projectRuntimeReplicaApiError(error)
        return apiError(mapped.message, mapped.status)
      }
    }
    const isolationAgentId = botInbox?.toAgentId
      ?? (usesBotComputerIsolation(channelKind)
        ? participants.find((participant): participant is Extract<Participant, { kind: 'agent' }> => participant.kind === 'agent')?.agentId
        : undefined)
    const isolatedFolder = isolationAgentId
      ? joinIsolatedBotFolder(projectFolderRelativePath || '.', isolationAgentId)
      : null
    const isolatedBrowserProfileId = isolationAgentId
      ? isolatedBotBrowserProfileId(isolationAgentId)
      : null
    const workspaceContext = shouldBindWorkspace
      ? await resolveConversationWorkspaceContext({
          orgId: scope.orgId,
          workspaceId: requestedWorkspaceId,
          ownerUserId: user.uid,
          runtimeTarget,
          runtimeLabel,
          mappingId: authorizedWorkspaceRuntime && 'mappingId' in authorizedWorkspaceRuntime
            ? authorizedWorkspaceRuntime.mappingId
            : requestedMappingId,
          mappingLabel: authorizedWorkspaceRuntime && 'mappingLabel' in authorizedWorkspaceRuntime
            ? authorizedWorkspaceRuntime.mappingLabel
            : undefined,
          shareMode,
          projectId: convScope === 'project' ? scopeRefId : undefined,
          projectName,
          folderRelativePath: isolatedFolder || projectFolderRelativePath,
          ...(isolatedBrowserProfileId ? { browserProfileId: isolatedBrowserProfileId } : {}),
          companyId,
          companyName,
          companyDomain,
          companyLinkedOrgId,
        })
      : null
    if (shouldBindWorkspace && !workspaceContext) {
      return apiError(
        convScope === 'company'
          ? 'Company Cowork folder could not be prepared for this organisation'
          : 'Workspace not found for this organisation',
        404,
      )
    }
    let boundWorkspaceContext = workspaceContext
    if (boundWorkspaceContext && (boundWorkspaceContext.folderScope === 'company'
      || (boundWorkspaceContext.folderScope === 'project' && boundWorkspaceContext.companyId))) {
      const { ensureCompanyCoworkFolderOnVps } = await import('@/lib/client-provisioning/ensure-company-cowork')
      const ensured = await ensureCompanyCoworkFolderWithinBudget(
        () => ensureCompanyCoworkFolderOnVps(boundWorkspaceContext!),
      )
      if (!ensured.ok) {
        const failure = ensured as { ok: false; error: string }
        return apiError(
          failure.error || 'Setting up the company Cowork folder failed. Try again in a moment.',
          409,
        )
      }
      if (!('deferred' in ensured)) {
        boundWorkspaceContext = ensured.workspace
      }
      // Deferred/timeout: create with the resolved workspace context; first
      // message dispatch still runs ensureCompanyCoworkFolderOnVps.
    }
    const contextRefs = await resolveContextReferences(
      sanitizeContextReferenceSeeds((body as Record<string, unknown>).contextRefs),
      user,
      scope.orgId,
    )

    const conversation = await createConversation({
      orgId: scope.orgId,
      startedBy: user.uid,
      participants,
      orchestration,
      title,
      ...(channelKind !== 'messages' ? { channelKind } : {}),
      ...(botInbox ? { botInbox } : {}),
      scope: convScope,
      scopeRefId: convScope === 'workspace' ? boundWorkspaceContext?.workspaceId ?? scopeRefId : scopeRefId,
      ...(boundWorkspaceContext ? { workspaceContext: boundWorkspaceContext } : {}),
      contextRefs,
    })

    // First project chat becomes the command session when the project has none yet
    // (or when the caller explicitly requests bindCommandSession).
    const bindCommandSession = body.bindCommandSession === true
      || (convScope === 'project' && typeof scopeRefId === 'string' && scopeRefId.length > 0)
    if (bindCommandSession && convScope === 'project' && scopeRefId) {
      try {
        const { bindProjectCommandSession, normalizeCommandSession } = await import('@/lib/projects/commandSession')
        const projectSnap = await adminDb.collection('projects').doc(scopeRefId).get()
        const existingBinding = normalizeCommandSession(projectSnap.data()?.commandSession)
        if (bindCommandSession && body.bindCommandSession === true) {
          await bindProjectCommandSession({
            projectId: scopeRefId,
            conversationId: conversation.id,
            orgId: scope.orgId,
            boundBy: user.uid,
          })
        } else if (!existingBinding?.enabled) {
          await bindProjectCommandSession({
            projectId: scopeRefId,
            conversationId: conversation.id,
            orgId: scope.orgId,
            boundBy: user.uid,
          })
        }
      } catch (error) {
        console.error('[conversations] command-session auto-bind failed', error)
      }
    }

    return apiSuccess({ conversation: publicConversationView(conversation, user.uid) }, 201)
  }),
)

const listConversationsHandler = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser) => {
    const { searchParams } = new URL(req.url)
    const orgIdParam = searchParams.get('orgId')
    const scopeParam = searchParams.get('scope')
    const convScope = scopeParam && VALID_SCOPES.includes(scopeParam as ConversationScope)
      ? (scopeParam as ConversationScope)
      : undefined
    const scopeRefId = searchParams.get('scopeRefId')?.trim() || undefined
    const projectId = searchParams.get('projectId')?.trim() || undefined
    const includeAllScopes = searchParams.get('includeAllScopes')?.toLowerCase() === 'true'
      || searchParams.get('includeAllScopes')?.toLowerCase() === '1'

    const orgScope = resolveOrgScope(user, orgIdParam)
    if (!orgScope.ok) return apiError(orgScope.error, orgScope.status)
    if (user.role === 'ai' && (!user.orgId || user.orgId !== orgScope.orgId)) {
      return apiError('AI credentials are not authorised for this organisation', 403)
    }

    // includeAllScopes powers the Hermes Messages rail (Cowork folders / projects).
    // Default 30 drops older company folders from the sidebar; prefer the full
    // allowed page unless the client asked for a smaller limit.
    const rawLimit = parseInt(searchParams.get('limit') ?? (includeAllScopes ? '100' : '30'), 10)
    const limit = Math.min(Number.isFinite(rawLimit) ? rawLimit : (includeAllScopes ? 100 : 30), 100)
    const conversations = await listConversations(orgScope.orgId, user, limit, {
      scope: convScope,
      scopeRefId,
      projectId,
      includeAllScopes,
    })

    return apiSuccess({
      conversations: conversations.map((conversation) => publicConversationView(conversation, user.uid)),
    })
  },
)

// This route is an initial/fallback rail load. Keep its Firestore work visible
// beside the long-lived live-stream snapshots while investigating read costs.
export const GET = (req: NextRequest, context?: unknown) =>
  runWithFirestoreReadAudit(
    'api/v1/conversations:get',
    () => listConversationsHandler(req, context),
    { logEveryRun: true },
  )
