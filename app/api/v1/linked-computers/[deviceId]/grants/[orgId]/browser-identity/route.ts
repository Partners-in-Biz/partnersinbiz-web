import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { setDeviceGrantBrowserIdentity } from '@/lib/linked-computers/store'
import { enqueueBrowserPolicyJobs } from '@/lib/linked-computers/agent-host-service'
import { lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'

type Context = { params: Promise<{ deviceId: string; orgId: string }> }

export async function handleBrowserIdentity(
  req: NextRequest,
  user: { uid: string },
  deviceId: string,
  orgId: string,
  save = setDeviceGrantBrowserIdentity,
  enqueue = enqueueBrowserPolicyJobs,
): Promise<Response> {
  try {
    const body = await req.json() as Record<string, unknown>
    if (typeof body.useRealProfile !== 'boolean' || typeof body.headed !== 'boolean' || typeof body.autoclose !== 'boolean') {
      throw new Error('linked computers: invalid browser identity')
    }
    const realProfilePin = body.realProfilePin === null || body.realProfilePin === undefined
      ? null
      : typeof body.realProfilePin === 'string' ? body.realProfilePin : null
    if (body.realProfilePin !== null && body.realProfilePin !== undefined && realProfilePin === null) {
      throw new Error('linked computers: invalid browser profile pin')
    }
    const identity = await save({
      deviceId,
      orgId,
      actorUserId: user.uid,
      identity: {
        useRealProfile: body.useRealProfile,
        realProfilePin,
        headed: body.headed,
        autoclose: body.autoclose,
      },
    })
    const jobIds = await enqueue({
      deviceId,
      orgId,
      actorUserId: user.uid,
      browserPolicy: {
        useRealProfile: identity.useRealProfile,
        realProfilePin: identity.realProfilePin,
        headed: identity.headed,
        autoclose: identity.autoclose,
      },
    }).catch(() => [] as string[])
    return NextResponse.json({ success: true, data: { browserIdentity: identity, jobIds } }, { headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}

export const PUT = withAuth('client', async (req: NextRequest, user, context: Context) => {
  const { deviceId, orgId } = await context.params
  return handleBrowserIdentity(req, user, deviceId, orgId)
})
