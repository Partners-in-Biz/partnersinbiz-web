import { NextRequest, NextResponse } from 'next/server'
import { claimPendingDeviceRotation, recordDeviceHeartbeat } from '@/lib/linked-computers/store'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import { bindLinkedRuntimeTransport, updateLinkedRuntimeTransportEndpoint } from '@/lib/linked-computers/transport'

type Context = { params: Promise<{ deviceId: string }> }
export async function handleDeviceHeartbeat(req: NextRequest, deviceId: string, auth = authenticateSignedDeviceRequest, record = recordDeviceHeartbeat, updateTransport = updateLinkedRuntimeTransportEndpoint, bindTransport = bindLinkedRuntimeTransport, claimRotation = claimPendingDeviceRotation): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const body = JSON.parse(rawBody)
    if (typeof body.runtimeVersion !== 'string' || !['ok', 'degraded'].includes(body.health)) throw new Error('linked computers: invalid heartbeat')
    const capabilities = Array.isArray(body.capabilities) && body.capabilities.includes('workspace.execute') ? ['workspace.execute'] as const : []
    await record({ deviceId, runtimeVersion: body.runtimeVersion, health: body.health, capabilities: [...capabilities] })
    let transportToken: string | undefined
    if (body.bootstrapTransport === true) {
      transportToken = (await bindTransport({ deviceId, endpoint: body.runtimeEndpoint, credentialVersion: identity.credentialVersion })).transportToken
    } else if (body.runtimeEndpoint !== undefined) {
      await updateTransport({ deviceId, endpoint: body.runtimeEndpoint, credentialVersion: identity.credentialVersion })
    }
    const rotation = body.claimRotation === true
      ? await claimRotation({ deviceId, authenticatedCredentialVersion: identity.credentialVersion })
      : null
    return NextResponse.json({ success: true, data: { acceptedAt: new Date().toISOString(), ...(transportToken ? { transportToken } : {}), ...(rotation ? { rotation } : {}) } }, { headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}
export const POST = async (req: NextRequest, context: Context) => handleDeviceHeartbeat(req, (await context.params).deviceId)
