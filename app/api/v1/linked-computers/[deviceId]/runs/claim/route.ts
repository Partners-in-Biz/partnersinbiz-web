import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import { claimOldestLinkedRun } from '@/lib/linked-computers/run-queue-store'

type Context = { params: Promise<{ deviceId: string }> }

export async function handleLinkedRunClaim(
  req: NextRequest,
  deviceId: string,
  auth = authenticateSignedDeviceRequest,
  claim = claimOldestLinkedRun,
): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const job = await claim({ deviceId, credentialVersion: identity.credentialVersion })
    return NextResponse.json({ success: true, data: job }, { status: job ? 200 : 204, headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}

export const POST = async (req: NextRequest, context: Context) => handleLinkedRunClaim(req, (await context.params).deviceId)
