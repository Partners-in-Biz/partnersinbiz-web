import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { putDeviceGrant } from '@/lib/linked-computers/store'
import { lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'

type Context = { params: Promise<{ deviceId: string }> }
export async function handleDeviceGrant(req: NextRequest, user: { uid: string }, deviceId: string, put = putDeviceGrant): Promise<Response> {
  try {
    const body = await req.json()
    if (typeof body.orgId !== 'string' || !['active', 'paused', 'revoked'].includes(body.status)) throw new Error('linked computers: invalid grant')
    const requestedAccessMode = body.accessMode
    if (requestedAccessMode !== undefined && !['owner', 'organization', 'selected_users'].includes(requestedAccessMode)) throw new Error('linked computers: invalid access mode')
    const requestedUserIds = Array.isArray(body.allowedUserIds) ? body.allowedUserIds.filter((value: unknown): value is string => typeof value === 'string') : []
    const accessMode = requestedAccessMode ?? (requestedUserIds.length > 0 ? 'selected_users' : 'owner')
    const allowedUserIds = accessMode === 'selected_users' ? requestedUserIds : []
    await put({ deviceId, orgId: body.orgId, actorUserId: user.uid, status: body.status, capabilities: ['workspace.execute', 'workspace.sync'], accessMode, allowedUserIds })
    return NextResponse.json({ success: true }, { headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}
export const PUT = withAuth('client', async (req: NextRequest, user, context: Context) => handleDeviceGrant(req, user, (await context.params).deviceId))
