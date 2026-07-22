import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { adoptLegacyLocationOntoLinkedDevice } from '@/lib/linked-computers/crypto'
import { lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ deviceId: string }> }

export async function handleAdoptLocation(
  req: NextRequest,
  user: ApiUser,
  deviceId: string,
  adopt = adoptLegacyLocationOntoLinkedDevice,
): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const adoptLocationId = typeof body.adoptLocationId === 'string' ? body.adoptLocationId.trim() : ''
    if (!adoptLocationId) {
      return NextResponse.json({ success: false, error: 'adoptLocationId is required' }, {
        status: 400,
        headers: noStoreHeaders,
      })
    }
    // AI/admin may act for a device owner; ordinary clients always act as themselves.
    const actorUserId = (user.role === 'ai' || user.role === 'admin')
      && typeof body.actorUserId === 'string'
      && body.actorUserId.trim()
      ? body.actorUserId.trim()
      : user.uid
    if ((user.role === 'ai' || user.role === 'admin') && actorUserId === 'ai-agent') {
      return NextResponse.json({
        success: false,
        error: 'actorUserId is required for agent adoption (device owner or organisation admin)',
      }, { status: 400, headers: noStoreHeaders })
    }

    const result = await adopt({
      actorUserId,
      deviceId,
      adoptLocationId,
    })
    return NextResponse.json({ success: true, data: result }, {
      status: result.alreadyAdopted ? 200 : 201,
      headers: noStoreHeaders,
    })
  } catch (error) {
    return lifecycleError(error)
  }
}

export const POST = withAuth('client', async (req: NextRequest, user, context: Context) => (
  handleAdoptLocation(req, user, (await context.params).deviceId)
))
