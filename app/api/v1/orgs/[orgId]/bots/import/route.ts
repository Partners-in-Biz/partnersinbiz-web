/**
 * POST /api/v1/orgs/[orgId]/bots/import
 * Clone a shared custom GrokBot onto a linked computer / VPS in this org.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { allocateBotHandle, canCloneBotShare, parseBotShareIdFromInput } from '@/lib/messages/bot-shares'
import { getBotShare } from '@/lib/messages/bot-share-store'
import { memberOrgRole, provisionCustomBotOnDevice } from '@/lib/messages/provision-custom-bot'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ orgId: string }> }

export const POST = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return apiError('Invalid JSON body', 400)

    const shareId = parseBotShareIdFromInput(body.shareId ?? body.url ?? body.link)
    if (!shareId) return apiError('A valid Bot share link is required', 400)
    const deviceId = String(body.deviceId ?? '').trim()
    if (!deviceId) return apiError('Choose a computer for this Bot', 400)

    const share = await getBotShare(shareId)
    if (!share) return apiError('Share not found', 404)
    if (!canCloneBotShare(share, { uid: user.uid, orgId: scope.orgId })) {
      return apiError('Share not found', 404)
    }

    const membership = await adminDb.collection('orgMembers').doc(`${scope.orgId}_${user.uid}`).get()
    const role = user.role === 'admin' ? 'owner' : memberOrgRole(membership.data()?.role)
    const existing = await adminDb.collection('agent_team').where('scopeOrgId', '==', scope.orgId).get()
    const taken = existing.docs.map((doc) => String((doc.data() as { agentHandle?: string }).agentHandle || ''))
    const handle = allocateBotHandle(body.agentHandle ?? share.snapshot.agentHandle, taken, share.snapshot.name)
    if (!handle) return apiError('Could not allocate a Bot ID in this organisation', 409)

    try {
      const created = await provisionCustomBotOnDevice({
        orgId: scope.orgId,
        actorUserId: user.uid,
        role,
        handle,
        name: share.snapshot.name,
        roleTitle: share.snapshot.role,
        persona: share.snapshot.persona,
        defaultModel: share.snapshot.defaultModel,
        iconKey: share.snapshot.iconKey,
        colorKey: share.snapshot.colorKey,
        deviceId,
      })
      const { apiKey: _apiKey, ...safeAgent } = created.agent
      return apiSuccess({
        agent: safeAgent,
        importedFrom: share.shareId,
        deviceId: created.deviceId,
        runtimeTargetId: created.runtimeTargetId,
        status: 'installing',
      }, 201)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import Bot'
      const status = typeof (error as { status?: number }).status === 'number' ? (error as { status: number }).status : undefined
      if (status && status >= 400 && status < 600) return apiError(message, status)
      if (/already exists|already_exists|6 ALREADY_EXISTS/i.test(message)) {
        return apiError('A Bot with that ID already exists in this organisation', 409)
      }
      if (/cannot create|only organisation|computers they own|belongs to another/i.test(message)) {
        return apiError(message, 403)
      }
      return apiErrorFromException(error)
    }
  },
)
