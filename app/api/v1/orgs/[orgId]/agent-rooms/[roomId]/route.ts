import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { archiveAgentRoomWithMirror, assertCanManageAgentRooms } from '@/lib/agent-rooms/service'
import { getAgentRoom, updateAgentRoom } from '@/lib/agent-rooms/store'
import type { AgentRoomMember } from '@/lib/agent-rooms/types'
import { clientCanAccessOrg } from '@/lib/llm-providers/org-guard'
import { orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orgId: string; roomId: string }> }

function asMembers(value: unknown): AgentRoomMember[] | undefined {
  if (value === undefined) return undefined
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

function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

async function requireRoomAccess(user: Parameters<typeof clientCanAccessOrg>[0], orgId: string) {
  if (!clientCanAccessOrg(user, orgId)) return apiError('Forbidden', 403)
  if (!(await orgFeatureFlagEnabled(orgId, 'agentRoomsEnabled'))) return apiError('feature_disabled', 404)
  try {
    await assertCanManageAgentRooms(user, orgId)
  } catch {
    return apiError('Forbidden', 403)
  }
  return null
}

export const PATCH = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { orgId, roomId } = await (ctx as Ctx).params
  const denied = await requireRoomAccess(user, orgId)
  if (denied) return denied

  const existing = await getAgentRoom(orgId, roomId)
  if (!existing) return apiError('Room not found', 404)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return apiError('Malformed JSON body', 400)
  try {
    const room = await updateAgentRoom({
      orgId,
      roomId,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      ...(body.pictureUrl === null || typeof body.pictureUrl === 'string' ? { pictureUrl: body.pictureUrl } : {}),
      ...(body.members !== undefined ? { members: asMembers(body.members) } : {}),
      ...(body.humanTeamIds !== undefined ? { humanTeamIds: asStringArray(body.humanTeamIds) } : {}),
    })
    return apiSuccess({ room })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'agent rooms: update failed'
    if (message.startsWith('agent rooms:')) return apiError(message, 400)
    throw error
  }
})

export const DELETE = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { orgId, roomId } = await (ctx as Ctx).params
  const denied = await requireRoomAccess(user, orgId)
  if (denied) return denied

  const existing = await getAgentRoom(orgId, roomId)
  if (!existing) return apiError('Room not found', 404)

  try {
    const room = await archiveAgentRoomWithMirror({ orgId, roomId })
    return apiSuccess({ room })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'agent rooms: archive failed'
    if (message.startsWith('agent rooms:')) return apiError(message, 400)
    throw error
  }
})
