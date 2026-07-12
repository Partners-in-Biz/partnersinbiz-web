import { NextRequest, NextResponse } from 'next/server'
import { acknowledgeDeviceRotation } from '@/lib/linked-computers/store'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'

type Context = { params: Promise<{ deviceId: string }> }

export async function handleRotationAck(req: NextRequest, deviceId: string, auth = authenticateSignedDeviceRequest, acknowledge = acknowledgeDeviceRotation): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const body = JSON.parse(rawBody) as { rotationDeliveryId?: unknown }
    if (typeof body.rotationDeliveryId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.rotationDeliveryId)) throw new Error('linked computers: invalid rotation delivery')
    const result = await acknowledge({ deviceId, authenticatedCredentialVersion: identity.credentialVersion, rotationDeliveryId: body.rotationDeliveryId })
    return NextResponse.json({ success: true, data: result }, { headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}

export const POST = async (req: NextRequest, context: Context) => handleRotationAck(req, (await context.params).deviceId)
