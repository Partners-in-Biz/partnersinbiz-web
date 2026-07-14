import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders, projectSyncRuntimeError } from '@/lib/linked-computers/http'
import type { ProjectSyncWorkerBinding } from '@/lib/project-sync/model'
import { recordDeviceProjectSyncFailure } from '@/lib/project-sync/runtime-service'

type Context = { params: Promise<{ deviceId: string }> }

export async function handleProjectSyncFailure(
  req: NextRequest,
  deviceId: string,
  auth = authenticateSignedDeviceRequest,
  record = recordDeviceProjectSyncFailure,
): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const body = JSON.parse(rawBody) as Record<string, unknown>
    if (typeof body.jobId !== 'string' || !(body.transferId === undefined || typeof body.transferId === 'string')
      || !['non_destructive_apply_required', 'unsupported_scale', 'unsupported_path', 'target_drift', 'source_drift', 'integrity_failure', 'retryable_transport'].includes(String(body.reason))
      || !['inventory', 'upload', 'apply', 'failure'].includes(String(body.jobKind)) || typeof body.failedAt !== 'string'
      || !(body.observedRevision === undefined || typeof body.observedRevision === 'string')
      || !body.binding || typeof body.binding !== 'object') {
      throw new Error('linked computers: invalid workspace.sync failure receipt')
    }
    const request = await record({
      identity: { deviceId, credentialVersion: identity.credentialVersion },
      jobId: body.jobId,
      binding: body.binding as ProjectSyncWorkerBinding,
      jobKind: body.jobKind as 'inventory' | 'upload' | 'apply' | 'failure',
      transferId: body.transferId,
      reason: body.reason as 'non_destructive_apply_required' | 'unsupported_scale' | 'unsupported_path' | 'target_drift' | 'source_drift' | 'integrity_failure' | 'retryable_transport',
      observedRevision: body.observedRevision as string | undefined,
      failedAt: body.failedAt,
    })
    return NextResponse.json({ success: true, data: { status: request.status, stateVersion: request.stateVersion } }, { headers: noStoreHeaders })
  } catch (error) {
    return projectSyncRuntimeError(error)
  }
}

export const POST = async (req: NextRequest, context: Context) => handleProjectSyncFailure(req, (await context.params).deviceId)
