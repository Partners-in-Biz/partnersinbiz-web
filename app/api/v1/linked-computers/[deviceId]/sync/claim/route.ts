import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders, projectSyncRuntimeError } from '@/lib/linked-computers/http'
import { claimDeviceProjectSyncJob } from '@/lib/project-sync/runtime-service'

type Context = { params: Promise<{ deviceId: string }> }

export async function handleProjectSyncClaim(
  req: NextRequest,
  deviceId: string,
  auth = authenticateSignedDeviceRequest,
  claim = claimDeviceProjectSyncJob,
): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const body = JSON.parse(rawBody || '{}') as Record<string, unknown>
    if (body.syncProtocolVersion !== 1) throw new Error('linked computers: workspace.sync protocol required')
    const job = await claim({ deviceId, credentialVersion: identity.credentialVersion })
    if (!job) return new Response(null, { status: 204, headers: noStoreHeaders })
    return NextResponse.json({ success: true, data: job }, { headers: noStoreHeaders })
  } catch (error) {
    return projectSyncRuntimeError(error)
  }
}

export const POST = async (req: NextRequest, context: Context) => handleProjectSyncClaim(req, (await context.params).deviceId)
