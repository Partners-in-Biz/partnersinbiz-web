import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import { updateLinkedRunFromDevice } from '@/lib/linked-computers/run-queue-store'
import type { LinkedRunReceipt } from '@/lib/linked-computers/run-queue'

type Context = { params: Promise<{ deviceId: string; jobId: string }> }

export async function handleLinkedRunComplete(req: NextRequest, deviceId: string, jobId: string, auth = authenticateSignedDeviceRequest, update = updateLinkedRunFromDevice): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const body = JSON.parse(rawBody) as { receipt?: LinkedRunReceipt; outcome?: unknown; output?: unknown; error?: unknown }
    if (!body.receipt || body.receipt.jobId !== jobId || !['completed', 'failed', 'cancelled'].includes(String(body.outcome))) throw new Error('linked computers: invalid run completion')
    await update({ deviceId, credentialVersion: identity.credentialVersion, jobId, receipt: body.receipt, event: 'complete', outcome: body.outcome as 'completed' | 'failed' | 'cancelled', ...(typeof body.output === 'string' ? { output: body.output } : {}), ...(typeof body.error === 'string' ? { error: body.error } : {}) })
    return NextResponse.json({ success: true, data: { accepted: true } }, { headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}

export const POST = async (req: NextRequest, context: Context) => { const p = await context.params; return handleLinkedRunComplete(req, p.deviceId, p.jobId) }
