/**
 * POST /api/v1/conversations — create a new conversation
 * GET  /api/v1/conversations?orgId=... — list conversations for the caller
 *
 * Auth: admin or client
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import {
  createConversation,
  listConversations,
  orgChatConfigDoc,
  resolveVisibleAgents,
} from '@/lib/conversations/conversations'
import type { AgentId, Participant, Conversation, ConversationScope } from '@/lib/conversations/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

const VALID_AGENT_IDS: AgentId[] = ['pip', 'theo', 'maya', 'sage', 'nora']
const VALID_SCOPES: ConversationScope[] = ['general', 'project', 'task', 'campaign']
const isPlatformWorkspace = (orgId: string) => orgId === PIB_PLATFORM_ORG_ID

export const POST = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser) => {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

    const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
    if (!orgId) return apiError('orgId is required', 400)

    // Scope check
    const scope = resolveOrgScope(user, orgId)
    if (!scope.ok) return apiError(scope.error, scope.status)

    // Participants validation
    if (!Array.isArray(body.participants)) {
      return apiError('participants must be an array', 400)
    }

    const callerRole: 'admin' | 'client' =
      user.role === 'admin' || user.role === 'ai' ? 'admin' : 'client'

    // Load visible agents for the caller's role
    const configDoc = await orgChatConfigDoc(scope.orgId).get()
    const config = configDoc.exists
      ? (configDoc.data() as { visibleAgents?: { admin?: AgentId[]; client?: AgentId[] } })
      : null
    const allowedAgentIds = new Set<AgentId>(resolveVisibleAgents(config, callerRole))
    const orgMemberUids = new Set<string>()
    if (!isPlatformWorkspace(scope.orgId)) {
      const orgDoc = await adminDb.collection('organizations').doc(scope.orgId).get()
      if (!orgDoc.exists) return apiError('Organisation not found', 404)
      const orgData = orgDoc.data() as { members?: Array<{ userId: string }> }
      ;(orgData.members ?? []).forEach((member) => orgMemberUids.add(member.userId))
    }
    const platformAdminUids = new Set<string>()
    if (callerRole === 'client') {
      const adminsSnap = await adminDb.collection('users').where('role', '==', 'admin').get()
      adminsSnap.docs.forEach((doc) => {
        const data = doc.data()
        const adminOrgId = data.orgId
        if (adminOrgId === undefined || adminOrgId === null || adminOrgId === '') {
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
        if (callerRole === 'client') {
          return apiError('Client conversations can only be started with people', 403)
        }
        const agentId = p.agentId as AgentId | undefined
        if (!agentId || !VALID_AGENT_IDS.includes(agentId)) {
          return apiError(`Invalid agent agentId: ${agentId}`, 400)
        }
        if (!allowedAgentIds.has(agentId)) {
          return apiError(`Agent ${agentId} is not visible to your role`, 403)
        }
        if (seenAgents.has(agentId)) continue

        // Look up agent name from agent_team
        const agentDoc = await adminDb.collection('agent_team').doc(agentId).get()
        const agentData = agentDoc.data()
        if (!agentDoc.exists || !agentData?.enabled) {
          return apiError(`Agent ${agentId} is not available`, 400)
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

    let orchestration: Conversation['orchestration']
    const selectedAgentIds = Array.from(seenAgents)
    if (
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

    if (callerRole === 'admin' && selectedAgentIds.length > 1) {
      orchestration = {
        mode: 'pip-orchestrator',
        dispatcherAgentId: 'pip',
        requestedAgentIds: selectedAgentIds,
      }
    }

    // Optional fields
    const title = typeof body.title === 'string' ? body.title.trim() : undefined
    const rawScope = body.scope
    const convScope: ConversationScope | undefined =
      typeof rawScope === 'string' && VALID_SCOPES.includes(rawScope as ConversationScope)
        ? (rawScope as ConversationScope)
        : undefined
    const scopeRefId = typeof body.scopeRefId === 'string' ? body.scopeRefId.trim() : undefined

    const conversation = await createConversation({
      orgId: scope.orgId,
      startedBy: user.uid,
      participants,
      orchestration,
      title,
      scope: convScope,
      scopeRefId,
    })

    return apiSuccess({ conversation }, 201)
  },
)

export const GET = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser) => {
    const { searchParams } = new URL(req.url)
    const orgIdParam = searchParams.get('orgId')

    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)

    const limit = Math.min(parseInt(searchParams.get('limit') ?? '30'), 100)
    const conversations = await listConversations(scope.orgId, user.uid, limit)

    return apiSuccess({ conversations })
  },
)
