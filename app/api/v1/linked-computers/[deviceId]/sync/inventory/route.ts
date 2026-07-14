import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders, projectSyncRuntimeError } from '@/lib/linked-computers/http'
import type { ProjectContentManifest, ProjectSyncWorkerBinding } from '@/lib/project-sync/model'
import { recordDeviceProjectSyncInventory } from '@/lib/project-sync/runtime-service'

type Context = { params: Promise<{ deviceId: string }> }

export async function handleProjectSyncInventory(
  req: NextRequest,
  deviceId: string,
  auth = authenticateSignedDeviceRequest,
  record = recordDeviceProjectSyncInventory,
): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const body = JSON.parse(rawBody) as Record<string, unknown>
    if (typeof body.jobId !== 'string' || typeof body.observedAt !== 'string'
      || !(body.pristineBootstrap === undefined || typeof body.pristineBootstrap === 'boolean')
      || !body.binding || typeof body.binding !== 'object' || !body.manifest || typeof body.manifest !== 'object') {
      throw new Error('linked computers: invalid workspace.sync inventory')
    }
    const request = await record({
      identity: { deviceId, credentialVersion: identity.credentialVersion },
      jobId: body.jobId,
      binding: body.binding as ProjectSyncWorkerBinding,
      manifest: body.manifest as ProjectContentManifest,
      pristineBootstrap: body.pristineBootstrap === true,
      observedAt: body.observedAt,
    })
    return NextResponse.json({ success: true, data: { status: request.status, stateVersion: request.stateVersion } }, { headers: noStoreHeaders })
  } catch (error) {
    return projectSyncRuntimeError(error)
  }
}

export const POST = async (req: NextRequest, context: Context) => handleProjectSyncInventory(req, (await context.params).deviceId)
