import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders, projectSyncRuntimeError } from '@/lib/linked-computers/http'
import type { ProjectSyncWorkerBinding } from '@/lib/project-sync/model'
import type { ProjectSyncRuntimeObject } from '@/lib/project-sync/runtime-jobs'
import { recordDeviceProjectSyncUploadReceipt } from '@/lib/project-sync/runtime-service'

type Context = { params: Promise<{ deviceId: string }> }

export async function handleProjectSyncUploadReceipt(
  req: NextRequest,
  deviceId: string,
  auth = authenticateSignedDeviceRequest,
  record = recordDeviceProjectSyncUploadReceipt,
): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const body = JSON.parse(rawBody) as Record<string, unknown>
    if (typeof body.jobId !== 'string' || !body.binding || typeof body.binding !== 'object' || !Array.isArray(body.objects)) {
      throw new Error('linked computers: invalid workspace.sync upload receipt')
    }
    await record({
      identity: { deviceId, credentialVersion: identity.credentialVersion },
      jobId: body.jobId,
      binding: body.binding as ProjectSyncWorkerBinding,
      objects: body.objects as ProjectSyncRuntimeObject[],
    })
    return NextResponse.json({ success: true, data: { verified: true } }, { headers: noStoreHeaders })
  } catch (error) {
    return projectSyncRuntimeError(error)
  }
}

export const POST = async (req: NextRequest, context: Context) => handleProjectSyncUploadReceipt(req, (await context.params).deviceId)
