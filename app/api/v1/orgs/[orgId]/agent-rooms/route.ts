import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { assertCanCreateAgentRoom, createAgentRoomWithMirror } from '@/lib/agent-rooms/service'
import { listAgentRooms } from '@/lib/agent-rooms/store'
import { normalizeAccessScope, normalizeAgentRoomSlug, type AgentRoomMember } from '@/lib/agent-rooms/types'
import { clientCanAccessOrg } from '@/lib/llm-providers/org-guard'
import { orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orgId: string }> }

function asMembers(value: unknown): AgentRoomMember[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const agentId = typeof row.agentId === 'string' ? row.agentId : ''
    if (!agentId) return []
    const deviceId = typeof row.deviceId === 'string' && row.deviceId.trim() ? row.deviceId.trim() : null
    return [{ agentId, deviceId }]
  })
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { orgId } = await (ctx as Ctx).params
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!(await orgFeatureFlagEnabled(orgId, 'agentRoomsEnabled'))) return apiError('feature_disabled', 404)
  return apiSuccess({ rooms: await listAgentRooms(orgId, { viewerUserId: user.uid }) })
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { orgId } = await (ctx as Ctx).params
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!(await orgFeatureFlagEnabled(orgId, 'agentRoomsEnabled'))) return apiError('feature_disabled', 404)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return apiError('Malformed JSON body', 400)
  const accessScope = normalizeAccessScope(body.accessScope)
  try {
    await assertCanCreateAgentRoom(user, orgId, accessScope)
  } catch {
    return apiError('Forbidden', 403)
  }

  const slug = normalizeAgentRoomSlug(body.slug)
  const name = typeof body.name === 'string' ? body.name : ''
  const members = asMembers(body.members)
  const humanTeamIds = asStringArray(body.humanTeamIds)
  const pictureUrl = typeof body.pictureUrl === 'string' || body.pictureUrl === null ? body.pictureUrl : undefined
  if (!slug || !name.trim()) return apiError('slug and name are required', 400)

  try {
    const room = await createAgentRoomWithMirror({
      orgId,
      slug,
      name,
      pictureUrl,
      members,
      humanTeamIds,
      accessScope,
      actor: user,
    })
    return apiSuccess({ room }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'agent rooms: create failed'
    if (message.startsWith('agent rooms:')) return apiError(message, 400)
    throw error
  }
})
