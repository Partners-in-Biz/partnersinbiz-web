import { AGENT_IDS } from '@/lib/agents/types'

export type HostedAgentDeviceKind = 'vps' | 'computer'
export type VpsProfileStatus = 'hosted' | 'missing'

const DEFAULT_VPS_PROBE_TTL_MS = 45_000
const DEFAULT_VPS_HOST = 'hermes-api.partnersinbiz.online'

function cleanAgentId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function uniqueIds(raw: readonly unknown[] | null | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of raw ?? []) {
    const id = cleanAgentId(value)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function resolveHostedAgentIds(input: {
  deviceKind?: HostedAgentDeviceKind | string | null
  availableAgentIds?: readonly unknown[] | null
  availableAgents?: readonly { agentId?: unknown }[] | null
  credentialReadyAgentIds?: readonly unknown[] | null
  desiredAgentIds?: readonly unknown[] | null
  vpsProfileStatus?: Record<string, VpsProfileStatus> | null
  platformAgentIds?: readonly string[]
}): string[] {
  const platform = new Set(input.platformAgentIds ?? AGENT_IDS)
  const available = new Set(uniqueIds(input.availableAgentIds))
  for (const row of input.availableAgents ?? []) {
    const id = cleanAgentId(row?.agentId)
    if (id) available.add(id)
  }
  const ready = new Set(uniqueIds(input.credentialReadyAgentIds))
  const desired = new Set(uniqueIds(input.desiredAgentIds))
  const status = input.vpsProfileStatus ?? {}
  const hosted = new Set<string>()
  const isVps = input.deviceKind === 'vps'

  if (isVps) {
    for (const id of platform) {
      if (status[id] === 'hosted') hosted.add(id)
    }
    for (const id of [...available, ...desired]) {
      if (!platform.has(id)) continue
      if (status[id] === 'missing') continue
      if (status[id] === 'hosted' || available.has(id)) hosted.add(id)
    }
    for (const id of available) {
      if (platform.has(id)) continue
      if (ready.has(id)) hosted.add(id)
    }
    return Array.from(hosted).sort()
  }

  for (const id of available) {
    if (platform.has(id) || ready.has(id)) hosted.add(id)
  }
  return Array.from(hosted).sort()
}

export function vpsPublicHealthUrl(agentId: string, host = process.env.HERMES_VPS_PUBLIC_HOST
  || process.env.HERMES_VPS_HOST
  || DEFAULT_VPS_HOST): string {
  const cleanedHost = host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return `https://${cleanedHost}/profiles/${encodeURIComponent(agentId)}/v1/health`
}

type ProbeCache = {
  expiresAt: number
  status: Record<string, VpsProfileStatus>
}

let probeCache: ProbeCache | null = null

export function resetVpsHostedProfileCache(): void {
  probeCache = null
}

/**
 * Probe public VPS `/v1/health` for platform agents.
 * 404 = not hosted. 200/502/other HTTP = profile exists (may be unhealthy).
 * Network failures leave the id unprobed so heartbeat can still win.
 */
export async function probeVpsPlatformProfiles(options: {
  agentIds?: readonly string[]
  fetchImpl?: typeof fetch
  nowMs?: () => number
  ttlMs?: number
} = {}): Promise<Record<string, VpsProfileStatus>> {
  const now = options.nowMs?.() ?? Date.now()
  const ttlMs = options.ttlMs ?? DEFAULT_VPS_PROBE_TTL_MS
  if (probeCache && probeCache.expiresAt > now) return probeCache.status

  const ids = uniqueIds(options.agentIds ?? AGENT_IDS)
  const fetchImpl = options.fetchImpl ?? fetch
  const status: Record<string, VpsProfileStatus> = {}
  await Promise.all(ids.map(async (agentId) => {
    try {
      const response = await fetchImpl(vpsPublicHealthUrl(agentId), { method: 'GET', cache: 'no-store' })
      status[agentId] = response.status === 404 ? 'missing' : 'hosted'
    } catch {
      // Leave unprobed.
    }
  }))
  probeCache = { expiresAt: now + ttlMs, status }
  return status
}

export async function hostedAgentIdsForDevice(input: {
  deviceKind?: HostedAgentDeviceKind | string | null
  availableAgentIds?: readonly unknown[] | null
  availableAgents?: readonly { agentId?: unknown }[] | null
  credentialReadyAgentIds?: readonly unknown[] | null
  desiredAgentIds?: readonly unknown[] | null
  platformAgentIds?: readonly string[]
  probeVps?: typeof probeVpsPlatformProfiles
}): Promise<string[]> {
  const vpsProfileStatus = input.deviceKind === 'vps'
    ? await (input.probeVps ?? probeVpsPlatformProfiles)()
    : null
  return resolveHostedAgentIds({
    deviceKind: input.deviceKind,
    availableAgentIds: input.availableAgentIds,
    availableAgents: input.availableAgents,
    credentialReadyAgentIds: input.credentialReadyAgentIds,
    desiredAgentIds: input.desiredAgentIds,
    vpsProfileStatus,
    platformAgentIds: input.platformAgentIds,
  })
}
