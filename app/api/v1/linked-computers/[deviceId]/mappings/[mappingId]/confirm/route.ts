import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import { confirmDeviceMappingPresence } from '@/lib/linked-computers/store'

type Context = { params: Promise<{ deviceId: string; mappingId: string }> }
export async function handleMappingConfirmation(req: NextRequest, deviceId: string, mappingId: string, auth = authenticateSignedDeviceRequest, update = confirmDeviceMappingPresence): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const body = JSON.parse(rawBody) as { present?: unknown }
    if (typeof body.present !== 'boolean' || !/^[A-Za-z0-9-]{8,128}$/.test(mappingId)) throw new Error('linked computers: invalid mapping confirmation')
    const result = await update({ deviceId, mappingId, ownerUserId: identity.ownerUserId, authenticatedCredentialVersion: identity.credentialVersion, present: body.present })
    return NextResponse.json({ success: true, data: result }, { headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}
export async function POST(req: NextRequest, context: Context) { const p = await context.params; return handleMappingConfirmation(req, p.deviceId, p.mappingId) }
