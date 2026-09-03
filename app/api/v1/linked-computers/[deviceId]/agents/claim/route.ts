import { NextRequest, NextResponse } from 'next/server'
import { authenticateSignedDeviceRequest, noStoreHeaders } from '@/lib/linked-computers/http'
import {
  claimOldestAgentHostJob,
  completeAgentHostJob,
} from '@/lib/linked-computers/agent-job-store'
import {
  getDecryptedLlmCredentials,
  getLlmProviderConnection,
} from '@/lib/llm-providers/store'
import {
  connectionCredentialVersion,
  requireDeliverableLlmCredentialBinding,
} from '@/lib/llm-providers/bindings'
import { adminDb } from '@/lib/firebase/admin'
import { linkedDeviceOwnerType } from '@/lib/linked-computers/policy'
import type { LinkedDevice } from '@/lib/linked-computers/types'
import { applyAgentHostJobResult } from '@/lib/linked-computers/agent-host-service'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ deviceId: string }> }
type DeviceIdentity = Awaited<ReturnType<typeof authenticateSignedDeviceRequest>>
const MAX_SUPERSEDED_JOBS_PER_CLAIM = 24

function deviceError(error: unknown): Response {
  const message = error instanceof Error ? error.message : ''
  const status = /not found/.test(message) ? 404
    : /authentication|signature|credential|replay|timestamp|tenant|authorization|revoked|device mismatch|active device/.test(message) ? 403
      : /lease|already final/.test(message) ? 409
        : /protocol/i.test(message) ? 400
          : 400
  const publicMessage = status === 404 ? 'Agent host job not found'
    : status === 403 ? 'Linked computer access denied'
      : status === 409 ? 'Agent host job lease is no longer current'
        : /protocol/i.test(message) ? 'Agent host protocol version 3 or 4 required. Update the linked computer runtime.'
          : 'Linked computer agent request invalid'
  return NextResponse.json({ success: false, error: publicMessage }, { status, headers: noStoreHeaders })
}

export async function handleAgentHostClaim(
  request: NextRequest,
  deviceId: string,
  authenticate: (request: NextRequest, deviceId: string, rawBody: string) => Promise<DeviceIdentity> = authenticateSignedDeviceRequest,
  claim: typeof claimOldestAgentHostJob = claimOldestAgentHostJob,
): Promise<Response> {
  try {
    const rawBody = await request.text()
    const identity = await authenticate(request, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('agent-host: tenant device mismatch')
    const body = JSON.parse(rawBody || '{}') as Record<string, unknown>
    const protocol = Number(body.agentHostProtocolVersion)
    if (protocol !== 3 && protocol !== 4) {
      throw new Error('agent-host: agentHostProtocolVersion 3 or 4 required')
    }
    for (let skipped = 0; skipped <= MAX_SUPERSEDED_JOBS_PER_CLAIM; skipped += 1) {
      const claimed = await claim({
        deviceId,
        ownerUserId: identity.ownerUserId,
        credentialVersion: identity.credentialVersion,
      }, protocol === 3
        ? { skip: (job) => Boolean(job.payload.managedProfile) }
        : undefined)
      if (!claimed) return new Response(null, { status: 204, headers: noStoreHeaders })
      if (protocol === 3 && claimed.managedProfile) {
        continue
      }
      let responseJob = claimed
      if ((claimed.kind === 'sync-credential' || claimed.kind === 'revoke-credential') && claimed.orgId) {
        const grantSnap = await adminDb.collection('linked_device_grants').doc(`${claimed.orgId}_${deviceId}`).get()
        if (grantSnap.exists) {
          const status = grantSnap.data()?.status
          const grantStatus = status === 'active' ? 'active' as const
            : status === 'paused' ? 'paused' as const
              : 'revoked' as const
          if (grantStatus !== 'active') {
            const completed = await completeAgentHostJob({
              deviceId,
              jobId: claimed.jobId,
              leaseToken: claimed.leaseToken || '',
              credentialVersion: identity.credentialVersion,
              ok: false,
              error: 'device grant not active',
            })
            await applyAgentHostJobResult(completed)
            continue
          }
          responseJob = { ...claimed, grantStatus }
        }
      }
      if (claimed.kind !== 'sync-credential') {
        return NextResponse.json({ success: true, data: responseJob }, { status: 200, headers: noStoreHeaders })
      }

      const delivery = claimed.credentialDelivery
      if (!delivery) throw new Error('agent-host: credential delivery metadata missing')
      const connection = await getLlmProviderConnection(delivery.connectionId)
      const deviceSnapshot = await adminDb.collection('linked_devices').doc(deviceId).get()
      const device = { deviceId, ...deviceSnapshot.data() } as LinkedDevice
      const ownerAuthorized = connection
        ? connection.scope === 'user'
          ? linkedDeviceOwnerType(device) === 'user' && connection.ownerUid === identity.ownerUserId
          : linkedDeviceOwnerType(device) === 'organization' && device.ownerOrgId === connection.orgId
        : false
      if (connection && (!deviceSnapshot.exists || !ownerAuthorized)) {
        throw new Error('agent-host: credential owner mismatch')
      }
      const currentGeneration = Boolean(
        connection
        && connection.status !== 'revoked'
        && connectionCredentialVersion(connection) === delivery.credentialVersion,
      )
      let bindingDeliverable = false
      if (currentGeneration && connection) {
        bindingDeliverable = await requireDeliverableLlmCredentialBinding({
          bindingId: delivery.bindingId,
          connectionId: delivery.connectionId,
          credentialVersion: delivery.credentialVersion,
          deviceId,
          ownerUid: connection.ownerUid,
          orgId: connection.orgId,
          scope: connection.scope,
          agentId: claimed.agentId,
        }).then(() => true, () => false)
      }
      if (!currentGeneration || !bindingDeliverable || !connection) {
        const completed = await completeAgentHostJob({
          deviceId,
          jobId: claimed.jobId,
          leaseToken: claimed.leaseToken || '',
          credentialVersion: identity.credentialVersion,
          ok: false,
          error: currentGeneration
            ? 'Credential binding is no longer deliverable'
            : 'Superseded by a newer credential generation',
        })
        await applyAgentHostJobResult(completed)
        continue
      }
      const credentials = await getDecryptedLlmCredentials(connection)
      if (!credentials) {
        const completed = await completeAgentHostJob({
          deviceId,
          jobId: claimed.jobId,
          leaseToken: claimed.leaseToken || '',
          credentialVersion: identity.credentialVersion,
          ok: false,
          error: 'Credential material is unavailable',
        })
        await applyAgentHostJobResult(completed)
        continue
      }
      const deliveredCredentials = connection.provider === 'xai-oauth' || connection.provider === 'anthropic'
        ? { ...credentials, refresh_token: '' }
        : credentials
      responseJob = {
        ...claimed,
        credentialDelivery: { ...delivery, credentials: deliveredCredentials },
      }
      return NextResponse.json({ success: true, data: responseJob }, { status: 200, headers: noStoreHeaders })
    }
    return new Response(null, { status: 204, headers: noStoreHeaders })
  } catch (error) {
    return deviceError(error)
  }
}

export const POST = async (request: NextRequest, context: Context) => {
  const { deviceId } = await context.params
  return handleAgentHostClaim(request, deviceId)
}
