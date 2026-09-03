import crypto from 'node:crypto'
import type { AgentId } from '@/lib/agents/types'
import { isValidAgentId } from '@/lib/agents/types'
import { managedProfileName } from './managed-profile'

export type AgentHostJobKind = 'install' | 'sync-policy' | 'uninstall' | 'sync-credential' | 'revoke-credential'
export type AgentHostJobStatus = 'queued' | 'claimed' | 'completed' | 'failed' | 'cancelled' | 'expired'

export interface AgentHostJobPayload {
  agentId: AgentId
  policyVersion: string | null
  keepInSync: boolean
  runtimeSkills: string[]
  pibSkills: string[]
  vpsExternalDir: string | null
  preferredPort: number | null
  profileConfig?: {
    name: string
    role: string
    persona: string
    defaultModel: string
  } | null
  skillPack?: {
    packSha256: string
    policyVersion: string
    skillNames: string[]
    artifactPath: string
  } | null
  protocolVersion?: number
  /** Catalog id ('pip'). payload.agentId is the Hermes profile name on managed jobs. */
  catalogAgentId?: AgentId
  /** Optional managed-profile stamp. Runtime writes pib-managed.json on install when present. */
  managedProfile?: {
    orgId: string
    orgSlug: string
    agentId?: string
    profile: string
  } | null
  modelDefault?: { provider: string; model: string } | null
  apiServer?: { enable: true } | null
  browserPolicy?: {
    useRealProfile: boolean
    realProfilePin: string | null
    headed: boolean
    autoclose: boolean
  } | null
  credentialDelivery?: {
    bindingId: string
    connectionId: string
    credentialVersion: number
    provider: string
    hermesProvider: string
    envVar: string | null
    canaryModel: string
    /**
     * How the credential is applied on the host.
     * - 'env' — API-key/env-var provider (e.g. DeepSeek). The key is written to
     *   the profile .env and verified against the already-running gateway; no
     *   profile restart or idle window is required.
     * - 'restart' — OAuth provider (e.g. xai-oauth / openai-codex). The profile
     *   must be idle so its gateway can reload the refreshed token.
     */
    applyMode?: 'env' | 'restart'
  } | null
}

export type CredentialApplyMode = 'env' | 'restart'

/** Resolve the apply mode for a credential delivery, defaulting new payloads to restart. */
export function credentialDeliveryApplyMode(delivery: {
  applyMode?: 'env' | 'restart'
  envVar?: string | null
} | null | undefined): CredentialApplyMode {
  if (delivery?.applyMode === 'env' || delivery?.applyMode === 'restart') return delivery.applyMode
  // Older payloads predate applyMode; env-var deliveries are live-applied,
  // everything else keeps the restart path.
  return delivery?.envVar ? 'env' : 'restart'
}

export interface AgentHostJob {
  jobId: string
  idempotencyKey: string
  requestFingerprint: string
  deviceId: string
  orgId: string
  actorUserId: string
  credentialVersion: number
  kind: AgentHostJobKind
  status: AgentHostJobStatus
  attempt: number
  leaseToken?: string
  leaseExpiresAtMs?: number
  claimedAtMs?: number
  completedAtMs?: number
  payload: AgentHostJobPayload
  result?: Record<string, unknown>
  error?: string
  createdAtMs: number
  updatedAtMs: number
  expiresAtMs: number
}

export interface PublicAgentHostJob {
  jobId: string
  kind: AgentHostJobKind
  status: AgentHostJobStatus
  agentId: AgentId
  orgId?: string
  catalogAgentId?: AgentId
  policyVersion: string | null
  keepInSync: boolean
  runtimeSkills: string[]
  pibSkills: string[]
  vpsExternalDir: string | null
  preferredPort: number | null
  profileConfig?: AgentHostJobPayload['profileConfig']
  skillPack?: AgentHostJobPayload['skillPack']
  protocolVersion?: number
  managedProfile?: AgentHostJobPayload['managedProfile']
  modelDefault?: AgentHostJobPayload['modelDefault']
  apiServer?: AgentHostJobPayload['apiServer']
  browserPolicy?: AgentHostJobPayload['browserPolicy']
  grantStatus?: 'active' | 'paused' | 'revoked'
  credentialDelivery?: AgentHostJobPayload['credentialDelivery'] & {
    /** Claim-only secret material. Never persisted in the job document. */
    credentials?: Record<string, string>
  }
  leaseToken?: string
  createdAt: string
  updatedAt: string
}

export function catalogAgentIdFromPayload(payload: Pick<AgentHostJobPayload, 'agentId' | 'catalogAgentId' | 'managedProfile'>): AgentId {
  if (payload.catalogAgentId && isValidAgentId(payload.catalogAgentId)) return payload.catalogAgentId
  const fromManaged = payload.managedProfile?.agentId
  if (fromManaged && isValidAgentId(fromManaged)) return fromManaged
  return payload.agentId
}

/** Managed PiB specialist ports — mirrors scripts/start-local-runtime-fleet.sh */
export const MANAGED_AGENT_PORTS: Record<string, number> = {
  pip: 8755,
  theo: 8756,
  maya: 8757,
  sage: 8758,
  nora: 8759,
  ads: 8767,
  'qa-release': 8768,
  support: 8769,
  data: 8770,
  docs: 8771,
  seo: 8772,
  sales: 8773,
}

export function preferredPortForAgent(agentId: string): number | null {
  return MANAGED_AGENT_PORTS[agentId] ?? null
}

export function agentHostJobId(input: {
  deviceId: string
  kind: AgentHostJobKind
  agentId: string
  policyVersion?: string | null
  idempotencyKey: string
}): string {
  return crypto.createHash('sha256')
    .update([
      'linked-device-agent-job:v1',
      input.deviceId,
      input.kind,
      input.agentId,
      input.policyVersion ?? '',
      input.idempotencyKey,
    ].join('\n'))
    .digest('hex')
    .slice(0, 32)
}

export function agentHostRequestFingerprint(input: {
  deviceId: string
  kind: AgentHostJobKind
  agentId: string
  policyVersion: string | null
  keepInSync: boolean
  runtimeSkills: string[]
  pibSkills: string[]
  vpsExternalDir: string | null
  preferredPort: number | null
  packSha256?: string | null
  profileConfig?: AgentHostJobPayload['profileConfig']
  credentialDelivery?: AgentHostJobPayload['credentialDelivery']
  catalogAgentId?: AgentId | null
  managedProfile?: AgentHostJobPayload['managedProfile']
  modelDefault?: AgentHostJobPayload['modelDefault']
  apiServer?: AgentHostJobPayload['apiServer']
  browserPolicy?: AgentHostJobPayload['browserPolicy']
}): string {
  return crypto.createHash('sha256')
    .update(JSON.stringify({
      deviceId: input.deviceId,
      kind: input.kind,
      agentId: input.agentId,
      policyVersion: input.policyVersion,
      keepInSync: input.keepInSync,
      runtimeSkills: [...input.runtimeSkills].sort(),
      pibSkills: [...input.pibSkills].sort(),
      vpsExternalDir: input.vpsExternalDir,
      preferredPort: input.preferredPort,
      packSha256: input.packSha256 ?? null,
      profileConfig: input.profileConfig ?? null,
      credentialDelivery: input.credentialDelivery ?? null,
      catalogAgentId: input.catalogAgentId ?? null,
      managedProfile: input.managedProfile ?? null,
      modelDefault: input.modelDefault ?? null,
      apiServer: input.apiServer ?? null,
      browserPolicy: input.browserPolicy ?? null,
    }))
    .digest('hex')
}

export function parseAgentHostJobPayload(value: unknown): AgentHostJobPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('agent-host: invalid payload')
  const row = value as Record<string, unknown>
  if (!isValidAgentId(row.agentId)) throw new Error('agent-host: invalid agentId')
  const runtimeSkills = Array.isArray(row.runtimeSkills)
    ? row.runtimeSkills.filter((item): item is string => typeof item === 'string')
    : []
  const pibSkills = Array.isArray(row.pibSkills)
    ? row.pibSkills.filter((item): item is string => typeof item === 'string')
    : []
  const preferredPort = Number(row.preferredPort)
  const skillPack = row.skillPack && typeof row.skillPack === 'object' && !Array.isArray(row.skillPack)
    ? (() => {
        const pack = row.skillPack as Record<string, unknown>
        const packSha256 = typeof pack.packSha256 === 'string' ? pack.packSha256 : ''
        const policyVersion = typeof pack.policyVersion === 'string' ? pack.policyVersion : ''
        const artifactPath = typeof pack.artifactPath === 'string' ? pack.artifactPath : ''
        const skillNames = Array.isArray(pack.skillNames)
          ? pack.skillNames.filter((item): item is string => typeof item === 'string')
          : []
        if (!packSha256 || !policyVersion || !artifactPath) return null
        return { packSha256, policyVersion, skillNames, artifactPath }
      })()
    : null
  const profileConfig = row.profileConfig && typeof row.profileConfig === 'object' && !Array.isArray(row.profileConfig)
    ? (() => {
        const config = row.profileConfig as Record<string, unknown>
        const name = typeof config.name === 'string' ? config.name.trim().slice(0, 100) : ''
        const role = typeof config.role === 'string' ? config.role.trim().slice(0, 120) : ''
        const persona = typeof config.persona === 'string' ? config.persona.trim().slice(0, 20_000) : ''
        const defaultModel = typeof config.defaultModel === 'string' ? config.defaultModel.trim().slice(0, 200) : ''
        return name && role && persona ? { name, role, persona, defaultModel: defaultModel || 'auto' } : null
      })()
    : null
  const credentialDelivery = row.credentialDelivery && typeof row.credentialDelivery === 'object' && !Array.isArray(row.credentialDelivery)
    ? (() => {
        const delivery = row.credentialDelivery as Record<string, unknown>
        const bindingId = typeof delivery.bindingId === 'string' ? delivery.bindingId.trim() : ''
        const connectionId = typeof delivery.connectionId === 'string' ? delivery.connectionId.trim() : ''
        const credentialVersion = Number(delivery.credentialVersion)
        const provider = typeof delivery.provider === 'string' ? delivery.provider.trim() : ''
        const hermesProvider = typeof delivery.hermesProvider === 'string' ? delivery.hermesProvider.trim() : ''
        const envVar = typeof delivery.envVar === 'string' && delivery.envVar.trim() ? delivery.envVar.trim() : null
        const canaryModel = typeof delivery.canaryModel === 'string' ? delivery.canaryModel.trim() : ''
        const applyMode: 'env' | 'restart' | undefined = delivery.applyMode === 'env' || delivery.applyMode === 'restart'
          ? delivery.applyMode
          : undefined
        if (!bindingId || !connectionId || !Number.isInteger(credentialVersion) || credentialVersion < 1
          || !provider || !hermesProvider || !canaryModel) return null
        return { bindingId, connectionId, credentialVersion, provider, hermesProvider, envVar, canaryModel, ...(applyMode ? { applyMode } : {}) }
      })()
    : null
  const catalogAgentId = isValidAgentId(row.catalogAgentId) ? row.catalogAgentId : undefined
  const managedProfile = parseManagedProfileField(row.managedProfile, catalogAgentId)
  const modelDefault = parseModelDefaultField(row.modelDefault)
  const apiServer = parseApiServerField(row.apiServer)
  const browserPolicy = parseBrowserPolicyField(row.browserPolicy)
  return {
    agentId: row.agentId,
    policyVersion: typeof row.policyVersion === 'string' ? row.policyVersion : null,
    keepInSync: row.keepInSync === true,
    runtimeSkills,
    pibSkills,
    vpsExternalDir: typeof row.vpsExternalDir === 'string' ? row.vpsExternalDir : null,
    preferredPort: Number.isInteger(preferredPort) && preferredPort > 0 ? preferredPort : null,
    ...(profileConfig ? { profileConfig } : {}),
    ...(skillPack ? { skillPack } : {}),
    ...(typeof row.protocolVersion === 'number' ? { protocolVersion: row.protocolVersion } : {}),
    ...(catalogAgentId ? { catalogAgentId } : {}),
    ...(managedProfile ? { managedProfile } : {}),
    ...(modelDefault ? { modelDefault } : {}),
    ...(apiServer ? { apiServer } : {}),
    ...(browserPolicy ? { browserPolicy } : {}),
    ...(credentialDelivery ? { credentialDelivery } : {}),
  }
}

function parseManagedProfileField(
  value: unknown,
  catalogAgentId?: AgentId,
): NonNullable<AgentHostJobPayload['managedProfile']> | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('agent-host: invalid managedProfile')
  const row = value as Record<string, unknown>
  const orgId = typeof row.orgId === 'string' ? row.orgId.trim() : ''
  const orgSlug = typeof row.orgSlug === 'string' ? row.orgSlug.trim() : ''
  const profile = typeof row.profile === 'string' ? row.profile.trim() : ''
  const managedAgentId = typeof row.agentId === 'string' ? row.agentId.trim() : ''
  const nameAgentId = catalogAgentId || managedAgentId
  if (!orgId || !orgSlug || !profile || !nameAgentId) throw new Error('agent-host: invalid managedProfile')
  let expected: string
  try {
    expected = managedProfileName(orgSlug, nameAgentId)
  } catch {
    throw new Error('agent-host: invalid managedProfile')
  }
  if (profile !== expected) throw new Error('agent-host: managedProfile.profile mismatch')
  return {
    orgId,
    orgSlug,
    profile,
    ...(managedAgentId ? { agentId: managedAgentId } : {}),
  }
}

function parseModelDefaultField(value: unknown): NonNullable<AgentHostJobPayload['modelDefault']> | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('agent-host: invalid modelDefault')
  const row = value as Record<string, unknown>
  const provider = typeof row.provider === 'string' ? row.provider.trim() : ''
  const model = typeof row.model === 'string' ? row.model.trim() : ''
  if (!provider || !model) throw new Error('agent-host: invalid modelDefault')
  return { provider: provider.slice(0, 80), model: model.slice(0, 200) }
}

function parseApiServerField(value: unknown): NonNullable<AgentHostJobPayload['apiServer']> | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('agent-host: invalid apiServer')
  const row = value as Record<string, unknown>
  if (row.enable !== true) throw new Error('agent-host: invalid apiServer')
  return { enable: true }
}

function parseBrowserPolicyField(value: unknown): NonNullable<AgentHostJobPayload['browserPolicy']> | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('agent-host: invalid browserPolicy')
  const row = value as Record<string, unknown>
  if (typeof row.useRealProfile !== 'boolean' || typeof row.headed !== 'boolean' || typeof row.autoclose !== 'boolean') {
    throw new Error('agent-host: invalid browserPolicy')
  }
  const pin = row.realProfilePin == null ? null : typeof row.realProfilePin === 'string' ? row.realProfilePin.trim() : ''
  if (pin === '') {
    if (row.realProfilePin != null && row.realProfilePin !== null) throw new Error('agent-host: invalid browserPolicy')
  }
  if (pin && (pin.length > 64 || /[\\/]/.test(pin))) throw new Error('agent-host: invalid browserPolicy')
  return {
    useRealProfile: row.useRealProfile,
    realProfilePin: pin || null,
    headed: row.headed,
    autoclose: row.autoclose,
  }
}

export function toPublicAgentHostJob(job: AgentHostJob): PublicAgentHostJob {
  return {
    jobId: job.jobId,
    kind: job.kind,
    status: job.status,
    agentId: job.payload.agentId,
    ...(job.orgId ? { orgId: job.orgId } : {}),
    ...(job.payload.catalogAgentId ? { catalogAgentId: job.payload.catalogAgentId } : {}),
    policyVersion: job.payload.policyVersion,
    keepInSync: job.payload.keepInSync,
    runtimeSkills: job.payload.runtimeSkills,
    pibSkills: job.payload.pibSkills,
    vpsExternalDir: job.payload.vpsExternalDir,
    preferredPort: job.payload.preferredPort,
    ...(job.payload.profileConfig ? { profileConfig: job.payload.profileConfig } : {}),
    ...(job.payload.skillPack ? { skillPack: job.payload.skillPack } : {}),
    ...(job.payload.protocolVersion ? { protocolVersion: job.payload.protocolVersion } : {}),
    ...(job.payload.managedProfile ? { managedProfile: job.payload.managedProfile } : {}),
    ...(job.payload.modelDefault ? { modelDefault: job.payload.modelDefault } : {}),
    ...(job.payload.apiServer ? { apiServer: job.payload.apiServer } : {}),
    ...(job.payload.browserPolicy ? { browserPolicy: job.payload.browserPolicy } : {}),
    ...(job.payload.credentialDelivery ? { credentialDelivery: job.payload.credentialDelivery } : {}),
    ...(job.leaseToken ? { leaseToken: job.leaseToken } : {}),
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString(),
  }
}

export function transitionAgentHostJob(
  job: AgentHostJob,
  event:
    | { type: 'claim'; leaseToken: string; leaseExpiresAtMs: number; nowMs: number }
    | { type: 'complete'; result?: Record<string, unknown>; nowMs: number }
    | { type: 'fail'; error: string; nowMs: number },
): AgentHostJob {
  if (event.type === 'claim') {
    if (job.status !== 'queued' && job.status !== 'claimed') throw new Error('agent-host: job not claimable')
    return {
      ...job,
      status: 'claimed',
      attempt: job.attempt + 1,
      leaseToken: event.leaseToken,
      leaseExpiresAtMs: event.leaseExpiresAtMs,
      claimedAtMs: event.nowMs,
      updatedAtMs: event.nowMs,
    }
  }
  if (event.type === 'complete') {
    if (job.status !== 'claimed' && job.status !== 'queued') throw new Error('agent-host: job not completable')
    return {
      ...job,
      status: 'completed',
      result: event.result,
      error: undefined,
      completedAtMs: event.nowMs,
      updatedAtMs: event.nowMs,
      leaseToken: undefined,
      leaseExpiresAtMs: undefined,
    }
  }
  if (job.status !== 'claimed' && job.status !== 'queued') throw new Error('agent-host: job not failable')
  return {
    ...job,
    status: 'failed',
    error: event.error,
    completedAtMs: event.nowMs,
    updatedAtMs: event.nowMs,
    leaseToken: undefined,
    leaseExpiresAtMs: undefined,
  }
}
