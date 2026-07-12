import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import { updateLinkedRunFromDevice } from '@/lib/linked-computers/run-queue-store'
import type { LinkedRunReceipt } from '@/lib/linked-computers/run-queue'

type Context = { params: Promise<{ deviceId: string; jobId: string }> }

export async function handleLinkedRunProgress(req: NextRequest, deviceId: string, jobId: string, auth = authenticateSignedDeviceRequest, update = updateLinkedRunFromDevice): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const body = JSON.parse(rawBody) as { receipt?: LinkedRunReceipt; message?: unknown }
    if (!body.receipt || body.receipt.jobId !== jobId) throw new Error('linked computers: run receipt mismatch')
    await update({ deviceId, credentialVersion: identity.credentialVersion, jobId, receipt: body.receipt, event: 'progress' })
    return NextResponse.json({ success: true, data: { accepted: true } }, { headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}

export const POST = async (req: NextRequest, context: Context) => { const p = await context.params; return handleLinkedRunProgress(req, p.deviceId, p.jobId) }
