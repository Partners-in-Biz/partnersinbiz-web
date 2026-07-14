import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders, projectSyncRuntimeError } from '@/lib/linked-computers/http'
import type { ProjectSyncWorkerBinding } from '@/lib/project-sync/model'
import { recordDeviceProjectSyncTransferReceipt } from '@/lib/project-sync/runtime-service'

type Context = { params: Promise<{ deviceId: string }> }

export async function handleProjectSyncTransferReceipt(
  req: NextRequest,
  deviceId: string,
  auth = authenticateSignedDeviceRequest,
  record = recordDeviceProjectSyncTransferReceipt,
): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const body = JSON.parse(rawBody) as Record<string, unknown>
    if (typeof body.jobId !== 'string' || typeof body.transferId !== 'string'
      || typeof body.appliedRevision !== 'string' || typeof body.verifiedManifestRevision !== 'string'
      || typeof body.verifiedAt !== 'string' || !body.binding || typeof body.binding !== 'object'
      || !(body.beforeRevision === null || typeof body.beforeRevision === 'string')) {
      throw new Error('linked computers: invalid workspace.sync receipt')
    }
    const request = await record({
      identity: { deviceId, credentialVersion: identity.credentialVersion },
      jobId: body.jobId,
      binding: body.binding as ProjectSyncWorkerBinding,
      transferId: body.transferId,
      beforeRevision: body.beforeRevision,
      appliedRevision: body.appliedRevision,
      verifiedManifestRevision: body.verifiedManifestRevision,
      verifiedAt: body.verifiedAt,
    })
    return NextResponse.json({ success: true, data: { status: request.status, stateVersion: request.stateVersion } }, { headers: noStoreHeaders })
  } catch (error) {
    return projectSyncRuntimeError(error)
  }
}

export const POST = async (req: NextRequest, context: Context) => handleProjectSyncTransferReceipt(req, (await context.params).deviceId)
