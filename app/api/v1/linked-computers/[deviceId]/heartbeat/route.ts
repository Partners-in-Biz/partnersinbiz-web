import { NextRequest, NextResponse } from 'next/server'
import { claimPendingDeviceRotation, recordDeviceHeartbeat } from '@/lib/linked-computers/store'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import { reconcileDesiredAgentsAfterHeartbeat } from '@/lib/linked-computers/agent-host-service'
import { reconcileLlmCredentialsForLinkedDevice } from '@/lib/llm-providers/reconcile-device'

type Context = { params: Promise<{ deviceId: string }> }
export async function handleDeviceHeartbeat(req: NextRequest, deviceId: string, auth = authenticateSignedDeviceRequest, record = recordDeviceHeartbeat, claimRotation = claimPendingDeviceRotation, reconcile = reconcileDesiredAgentsAfterHeartbeat, reconcileCredentials = reconcileLlmCredentialsForLinkedDevice): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const body = JSON.parse(rawBody)
    if (typeof body.runtimeVersion !== 'string' || !['ok', 'degraded'].includes(body.health)) throw new Error('linked computers: invalid heartbeat')
    if (body.runtimeEndpoint !== undefined || body.bootstrapTransport !== undefined || body.transportToken !== undefined) throw new Error('linked computers: legacy transport fields are not accepted')
    const advertisedCapabilities = Array.isArray(body.capabilities) ? body.capabilities : []
    const rawAvailableAgentIds: unknown[] = Array.isArray(body.availableAgentIds) ? body.availableAgentIds : []
    const availableAgentIds: string[] = [...new Set(rawAvailableAgentIds.filter((value): value is string => (
      typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.trim())
    )).map((value) => value.trim()))].slice(0, 100)
    const hermesVersion = typeof body.hermesVersion === 'string' && body.hermesVersion.trim().length <= 64
      ? body.hermesVersion.trim() || null
      : null
    const healthReason = body.healthReason === 'hermes_unavailable'
      || body.healthReason === 'hermes_binary_missing'
      || body.healthReason === 'no_agents_available'
      ? body.healthReason
      : null
    const syncProtocolVersion = body.syncProtocolVersion === 1 ? 1 : null
    const capabilities = [
      ...(advertisedCapabilities.includes('workspace.execute') ? ['workspace.execute' as const] : []),
      ...(advertisedCapabilities.includes('workspace.sync') && syncProtocolVersion === 1 ? ['workspace.sync' as const] : []),
    ]
    await record({ deviceId, runtimeVersion: body.runtimeVersion, health: body.health, capabilities, syncProtocolVersion, availableAgentIds, hermesVersion, healthReason })
    // Best-effort: requeue missing keep-in-sync / desired installs without blocking heartbeat.
    void reconcile({ deviceId, availableAgentIds }).catch(() => undefined)
    void reconcileCredentials({ deviceId, availableAgentIds }).catch(() => undefined)
    const rotation = body.claimRotation === true
      ? await claimRotation({ deviceId, authenticatedCredentialVersion: identity.credentialVersion })
      : null
    return NextResponse.json({ success: true, data: { acceptedAt: new Date().toISOString(), ...(rotation ? { rotation } : {}) } }, { headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}
export const POST = async (req: NextRequest, context: Context) => handleDeviceHeartbeat(req, (await context.params).deviceId)
