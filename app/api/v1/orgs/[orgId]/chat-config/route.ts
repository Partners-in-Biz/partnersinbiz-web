/**
 * GET  /api/v1/orgs/[orgId]/chat-config — fetch org chat visibility config
 * PUT  /api/v1/orgs/[orgId]/chat-config — update org chat visibility config
 *
 * Auth: admin
 * Returns defaults when no doc has been written yet.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { orgChatConfigDoc } from '@/lib/conversations/conversations'
import { DEFAULT_CHAT_CONFIG } from '@/lib/conversations/types'
import { AGENT_IDS } from '@/lib/agents/types'
import type { OrgChatConfig } from '@/lib/conversations/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ orgId: string }> }

export const GET = withAuth(
  'admin',
  async (_req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)

    const doc = await orgChatConfigDoc(scope.orgId).get()

    if (!doc.exists) {
      // Return defaults without writing to Firestore
      const defaults: OrgChatConfig = {
        orgId: scope.orgId,
        ...DEFAULT_CHAT_CONFIG,
      }
      return apiSuccess(defaults)
    }

    return apiSuccess({ orgId: scope.orgId, ...doc.data() } as OrgChatConfig)
  },
)

export const PUT = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

    // Validate visibleAgents if provided
    const VALID_AGENTS = [...AGENT_IDS]
    if (body.visibleAgents !== undefined) {
      const va = body.visibleAgents as Record<string, unknown>
      for (const roleKey of ['admin', 'client'] as const) {
        if (va[roleKey] !== undefined) {
          if (!Array.isArray(va[roleKey])) {
            return apiError(`visibleAgents.${roleKey} must be an array`, 400)
          }
          const invalid = (va[roleKey] as unknown[]).filter(
            (id) => typeof id !== 'string' || !VALID_AGENTS.includes(id),
          )
          if (invalid.length > 0) {
            return apiError(
              `visibleAgents.${roleKey} contains invalid agent id(s): ${invalid.join(', ')}`,
              400,
            )
          }
        }
      }
    }

    // Build safe patch — only allow known fields
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.uid,
    }

    if (body.visibleAgents !== undefined) patch.visibleAgents = body.visibleAgents
    if (typeof body.enableClientToAdminChat === 'boolean') {
      patch.enableClientToAdminChat = body.enableClientToAdminChat
    }
    if (typeof body.enableClientToPiBTeamChat === 'boolean') {
      patch.enableClientToPiBTeamChat = body.enableClientToPiBTeamChat
    }

    const ref = orgChatConfigDoc(scope.orgId)
    await ref.set({ orgId: scope.orgId, ...patch }, { merge: true })

    const updated = await ref.get()
    const data = updated.data() ?? {}

    // Fill in any missing fields with defaults so the response is always complete
    const result: OrgChatConfig = {
      ...DEFAULT_CHAT_CONFIG,
      ...data,
      orgId: scope.orgId,
    }
    return apiSuccess(result)
  },
)
