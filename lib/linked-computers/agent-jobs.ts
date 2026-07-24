import crypto from 'node:crypto'
import type { AgentId } from '@/lib/agents/types'
import { isValidAgentId } from '@/lib/agents/types'

export type AgentHostJobKind = 'install' | 'sync-policy' | 'uninstall'
export type AgentHostJobStatus = 'queued' | 'claimed' | 'completed' | 'failed' | 'cancelled' | 'expired'

export interface AgentHostJobPayload {
  agentId: AgentId
  policyVersion: string | null
  keepInSync: boolean
  runtimeSkills: string[]
  pibSkills: string[]
  vpsExternalDir: string | null
  preferredPort: number | null
  skillPack?: {
    packSha256: string
    policyVersion: string
    skillNames: string[]
    artifactPath: string
  } | null
  protocolVersion?: number
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
  policyVersion: string | null
  keepInSync: boolean
  runtimeSkills: string[]
  pibSkills: string[]
  vpsExternalDir: string | null
  preferredPort: number | null
  skillPack?: AgentHostJobPayload['skillPack']
  protocolVersion?: number
  leaseToken?: string
  createdAt: string
  updatedAt: string
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
  return {
    agentId: row.agentId,
    policyVersion: typeof row.policyVersion === 'string' ? row.policyVersion : null,
    keepInSync: row.keepInSync === true,
    runtimeSkills,
    pibSkills,
    vpsExternalDir: typeof row.vpsExternalDir === 'string' ? row.vpsExternalDir : null,
    preferredPort: Number.isInteger(preferredPort) && preferredPort > 0 ? preferredPort : null,
    ...(skillPack ? { skillPack } : {}),
    ...(typeof row.protocolVersion === 'number' ? { protocolVersion: row.protocolVersion } : {}),
  }
}

export function toPublicAgentHostJob(job: AgentHostJob): PublicAgentHostJob {
  return {
    jobId: job.jobId,
    kind: job.kind,
    status: job.status,
    agentId: job.payload.agentId,
    policyVersion: job.payload.policyVersion,
    keepInSync: job.payload.keepInSync,
    runtimeSkills: job.payload.runtimeSkills,
    pibSkills: job.payload.pibSkills,
    vpsExternalDir: job.payload.vpsExternalDir,
    preferredPort: job.payload.preferredPort,
    ...(job.payload.skillPack ? { skillPack: job.payload.skillPack } : {}),
    ...(job.payload.protocolVersion ? { protocolVersion: job.payload.protocolVersion } : {}),
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
