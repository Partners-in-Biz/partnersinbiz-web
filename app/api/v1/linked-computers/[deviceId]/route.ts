import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { updateOwnedDevice, removeOwnedDevice } from '@/lib/linked-computers/store'
import { lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'

type Context = { params: Promise<{ deviceId: string }> }
export async function handleLinkedComputerUpdate(req: NextRequest, user: { uid: string }, deviceId: string, update = updateOwnedDevice): Promise<Response> {
  try {
    const body = await req.json()
    const label = typeof body.label === 'string' ? body.label : undefined
    const status = ['active', 'paused', 'revoked', 'removed'].includes(body.status) ? body.status : undefined
    if ((!label && !status) || (label && status)) throw new Error('linked computers: exactly one update required')
    await update({ deviceId, actorUserId: user.uid, ...(label ? { label } : { status }) } as never)
    return NextResponse.json({ success: true }, { headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}
export async function handleLinkedComputerRemove(user: { uid: string }, deviceId: string, remove = removeOwnedDevice): Promise<Response> {
  try {
    await remove({ deviceId, actorUserId: user.uid })
    return NextResponse.json({ success: true }, { headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}
export const PATCH = withAuth('client', async (req: NextRequest, user, context: Context) => handleLinkedComputerUpdate(req, user, (await context.params).deviceId))
export const DELETE = withAuth('client', async (_req: NextRequest, user, context: Context) => handleLinkedComputerRemove(user, (await context.params).deviceId))
