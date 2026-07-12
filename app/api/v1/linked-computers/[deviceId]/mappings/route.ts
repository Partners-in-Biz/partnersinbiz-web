import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { putWorkspaceMapping } from '@/lib/linked-computers/store'
import { lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'

type Context = { params: Promise<{ deviceId: string }> }
export async function handleDeviceMapping(req: NextRequest, user: { uid: string }, deviceId: string, put = putWorkspaceMapping): Promise<Response> {
  try {
    const body = await req.json()
    if (![body.mappingId, body.orgId, body.workspaceId, body.label].every((v) => typeof v === 'string') || !['active', 'stale', 'missing', 'paused', 'removed'].includes(body.status)) throw new Error('linked computers: invalid mapping')
    await put({ mappingId: body.mappingId, deviceId, orgId: body.orgId, workspaceId: body.workspaceId, actorUserId: user.uid, label: body.label, status: body.status })
    return NextResponse.json({ success: true }, { headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}
export const PUT = withAuth('client', async (req: NextRequest, user, context: Context) => handleDeviceMapping(req, user, (await context.params).deviceId))
