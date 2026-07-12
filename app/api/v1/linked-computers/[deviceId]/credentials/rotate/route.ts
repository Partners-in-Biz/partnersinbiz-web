import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { rotateDeviceCredential } from '@/lib/linked-computers/store'
import { lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'

type Context = { params: Promise<{ deviceId: string }> }
export async function handleCredentialRotation(user: { uid: string }, deviceId: string, rotate = rotateDeviceCredential): Promise<Response> {
  try { return NextResponse.json({ success: true, data: await rotate({ deviceId, actorUserId: user.uid }) }, { headers: noStoreHeaders }) }
  catch (error) { return lifecycleError(error) }
}
export const POST = withAuth('client', async (_req: NextRequest, user, context: Context) => handleCredentialRotation(user, (await context.params).deviceId))
