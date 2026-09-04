import { NextRequest, NextResponse } from 'next/server'
import { applyProjectionObservation } from '@/lib/agent-rooms/projection'
import { claimPendingDeviceRotation, recordDeviceHeartbeat } from '@/lib/linked-computers/store'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import { reconcileDesiredAgentsAfterHeartbeat } from '@/lib/linked-computers/agent-host-service'
import { reconcileLlmCredentialsForLinkedDevice } from '@/lib/llm-providers/reconcile-device'
import type { LinkedAvailableProfile } from '@/lib/linked-computers/types'

const AGENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/
const SKILLS_DIGEST_RE = /^[a-fA-F0-9]{1,128}$/

function parseAvailableProfiles(raw: unknown): LinkedAvailableProfile[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) return undefined
  const parsed: LinkedAvailableProfile[] = []
  for (const entry of raw.slice(0, 100)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    const profile = typeof row.profile === 'string' ? row.profile.trim() : ''
    const agentId = typeof row.agentId === 'string' ? row.agentId.trim() : ''
    if (!AGENT_ID_RE.test(profile) || !AGENT_ID_RE.test(agentId)) continue
    if (typeof row.healthy !== 'boolean') continue
    if (row.orgId !== null && row.orgId !== undefined) {
      if (typeof row.orgId !== 'string' || row.orgId.trim().length === 0 || row.orgId.trim().length > 64) continue
    }
    if (row.skillsDigest != null) {
      if (typeof row.skillsDigest !== 'string' || !SKILLS_DIGEST_RE.test(row.skillsDigest.trim())) continue
    }
    const projectionHash = typeof row.projectionHash === 'string' && /^[a-f0-9]{64}$/i.test(row.projectionHash.trim())
      ? row.projectionHash.trim().toLowerCase()
      : undefined
    const observedMeta = row.observedMeta && typeof row.observedMeta === 'object' && !Array.isArray(row.observedMeta)
      ? row.observedMeta as Record<string, unknown>
      : undefined
    parsed.push({
      profile,
      orgId: row.orgId == null ? null : row.orgId.trim(),
      agentId,
      healthy: row.healthy,
      skillsDigest: row.skillsDigest == null ? null : row.skillsDigest.trim().toLowerCase(),
      ...(projectionHash ? { projectionHash } : {}),
      ...(observedMeta ? { observedMeta } : {}),
    })
  }
  return parsed
}

type Context = { params: Promise<{ deviceId: string }> }
export async function handleDeviceHeartbeat(
  req: NextRequest,
  deviceId: string,
  auth = authenticateSignedDeviceRequest,
  record: (...args: Parameters<typeof recordDeviceHeartbeat>) => Promise<{ ignoredProfiles?: string[] } | void> = recordDeviceHeartbeat,
  claimRotation = claimPendingDeviceRotation,
  reconcile = reconcileDesiredAgentsAfterHeartbeat,
  reconcileCredentials = reconcileLlmCredentialsForLinkedDevice,
): Promise<Response> {
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
      typeof value === 'string' && AGENT_ID_RE.test(value.trim())
    )).map((value) => value.trim()))].slice(0, 100)
    const availableProfiles = parseAvailableProfiles(body.availableProfiles)
    const hermesVersion = typeof body.hermesVersion === 'string' && body.hermesVersion.trim().length <= 64
      ? body.hermesVersion.trim() || null
      : null
    const healthReason = body.healthReason === 'hermes_unavailable'
      || body.healthReason === 'hermes_binary_missing'
      || body.healthReason === 'no_agents_available'
      || body.healthReason === 'hermes_update_failed'
      ? body.healthReason
      : null
    const syncProtocolVersion = body.syncProtocolVersion === 1 ? 1 : null
    const capabilities = [
      ...(advertisedCapabilities.includes('workspace.execute') ? ['workspace.execute' as const] : []),
      ...(advertisedCapabilities.includes('workspace.sync') && syncProtocolVersion === 1 ? ['workspace.sync' as const] : []),
    ]
    const recorded = await record({
      deviceId,
      runtimeVersion: body.runtimeVersion,
      health: body.health,
      capabilities,
      syncProtocolVersion,
      availableAgentIds,
      hermesVersion,
      healthReason,
      ...(availableProfiles ? { availableProfiles } : {}),
    })
    // Best-effort: requeue missing keep-in-sync / desired installs without blocking heartbeat.
    void reconcile({
      deviceId,
      availableAgentIds,
      ...(availableProfiles ? { availableProfiles } : {}),
    }).catch(() => undefined)
    void reconcileCredentials({ deviceId, availableAgentIds }).catch(() => undefined)
    if (availableProfiles) {
      void Promise.all(availableProfiles.map((profile) => applyProjectionObservation({
        deviceId,
        orgId: profile.orgId,
        profile: profile.profile,
        observedHash: profile.projectionHash ?? null,
        observedMeta: profile.observedMeta,
      }))).catch(() => undefined)
    }
    const rotation = body.claimRotation === true
      ? await claimRotation({ deviceId, authenticatedCredentialVersion: identity.credentialVersion })
      : null
    const ignoredProfiles = recorded?.ignoredProfiles ?? []
    return NextResponse.json({ success: true, data: { acceptedAt: new Date().toISOString(), ownerUserId: identity.ownerUserId, ignoredProfiles, ...(rotation ? { rotation } : {}) } }, { headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}
export const POST = async (req: NextRequest, context: Context) => handleDeviceHeartbeat(req, (await context.params).deviceId)
