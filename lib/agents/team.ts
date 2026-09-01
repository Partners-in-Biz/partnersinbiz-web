/**
 * CRUD helpers for the `agent_team` Firestore collection.
 *
 * Encryption pattern: reuses AES-256-GCM from lib/social/encryption.ts.
 * apiKey is encrypted at rest using a fixed salt of 'agent-team' (no per-org
 * key derivation needed since these are platform-level, not per-org tokens).
 *
 * Reads always return the masked form of apiKey (last 6 chars, rest ●).
 * Callers that need the raw key for outbound calls must use decryptAgentKey().
 */

import crypto from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { mergeAgentRegistry, normalizeAgentRegistryInput } from './registry'
import { buildAgentSkillPolicyState } from './skill-policy'
import { buildRuntimeTargetMap, normalizeRuntimeTargets, selectAgentRuntimeTarget, type AgentDispatchTarget, type RuntimeTargetSelectionError } from './runtime-targets'
import type { AgentId, AgentRegistryEntry, AgentTeamDoc, AgentTeamStoredDoc } from './types'
import type { HermesProfileLink } from '@/lib/hermes/types'

// ---------------------------------------------------------------------------
// Encryption — AES-256-GCM, same algorithm as lib/social/encryption.ts.
// We derive the key from SOCIAL_TOKEN_MASTER_KEY with a fixed context string
// instead of an orgId so these platform-level keys share the same master key.
// ---------------------------------------------------------------------------
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AGENT_KEY_CONTEXT = 'agent-team-apikey'

interface EncryptedData {
  ciphertext: string // base64
  iv: string         // base64
  tag: string        // base64
}

function getMasterKey(): Buffer {
  const key = process.env.SOCIAL_TOKEN_MASTER_KEY?.trim()
  if (!key) throw new Error('Missing env var: SOCIAL_TOKEN_MASTER_KEY')
  if (key.length === 64 && /^[0-9a-f]+$/i.test(key)) {
    return Buffer.from(key, 'hex')
  }
  return crypto.createHash('sha256').update(key).digest()
}

function deriveAgentKey(): Buffer {
  return crypto.createHmac('sha256', getMasterKey()).update(AGENT_KEY_CONTEXT).digest()
}

function encryptAgentApiKey(plaintext: string): string {
  const key = deriveAgentKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const data: EncryptedData = {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  }
  return JSON.stringify(data)
}

function decryptAgentApiKey(stored: string): string {
  let data: EncryptedData
  try {
    data = JSON.parse(stored) as EncryptedData
  } catch {
    throw new Error('agent_team apiKey is not valid encrypted JSON')
  }
  const key = deriveAgentKey()
  const iv = Buffer.from(data.iv, 'base64')
  const tag = Buffer.from(data.tag, 'base64')
  const ciphertext = Buffer.from(data.ciphertext, 'base64')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext) + decipher.final('utf8')
}

function maskApiKey(plain: string): string {
  if (plain.length <= 6) return '●'.repeat(plain.length)
  return '●'.repeat(plain.length - 6) + plain.slice(-6)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
const COLLECTION = 'agent_team'
const DISPATCH_COLLECTION = 'agent_dispatch_configs'

export interface AgentRuntimeCallOptions {
  runtimeTarget?: string | null
}

export async function isConfiguredCompatibilityRuntimeTarget(agentId: AgentId, runtimeTarget: string): Promise<boolean> {
  const snap = await adminDb.collection(DISPATCH_COLLECTION).doc(agentId).get()
  return normalizeRuntimeTargets(snap.data()?.runtimeTargets).some((target) => target.id === runtimeTarget)
}

function preferredRuntimeTarget(options?: AgentRuntimeCallOptions): string | null {
  const raw = options?.runtimeTarget
    ?? process.env.PIB_HERMES_RUNTIME_TARGET
    ?? process.env.PIB_AGENT_RUNTIME_TARGET
    ?? null
  if (!raw) return null
  const cleaned = raw.trim().toLowerCase()
  // Chat sessions store linked-device:<uuid> as the runtime target. Hermes
  // dispatch configs only know vps/local — map VPS-hosted linked devices to vps.
  if (cleaned.startsWith('linked-device:')) {
    return 'vps'
  }
  return raw
}

function preferLocalRuntime(): boolean {
  return ['1', 'true', 'yes', 'local'].includes((process.env.PIB_PREFER_LOCAL_HERMES ?? '').toLowerCase())
}

function toPublicDoc(stored: AgentTeamStoredDoc & { id?: string }): AgentTeamDoc {
  let masked = '●●●●●●●●●●●● (re-enter key)'
  try {
    const plain = decryptAgentApiKey(stored.apiKey)
    masked = maskApiKey(plain)
  } catch {
    // Decryption fails when the doc was seeded with a different master key
    // (e.g. local key vs production key). Caller must update the key via PUT.
  }
  return {
    ...stored,
    ...mergeAgentRegistry(stored.agentId, stored),
    skillPolicy: stored.skillPolicy ?? buildAgentSkillPolicyState(stored.agentId) ?? undefined,
    apiKey: masked,
  }
}

async function getRaw(agentId: AgentId): Promise<AgentTeamStoredDoc | null> {
  const snap = await adminDb.collection(COLLECTION).doc(agentId).get()
  if (!snap.exists) return null
  return snap.data() as AgentTeamStoredDoc
}

async function resolveAgentDispatchTarget(
  agentId: AgentId,
  raw: AgentTeamStoredDoc | null,
  options?: AgentRuntimeCallOptions,
): Promise<AgentDispatchTarget | null> {
  let legacyApiKey: string | null = null
  try {
    legacyApiKey = raw?.apiKey ? decryptAgentApiKey(raw.apiKey).trim() : null
  } catch {
    legacyApiKey = null
  }

  let dispatchData: Record<string, unknown> = {}
  try {
    const snap = await adminDb.collection(DISPATCH_COLLECTION).doc(agentId).get()
    dispatchData = snap.exists ? snap.data() as Record<string, unknown> : {}
  } catch {
    dispatchData = {}
  }

  const resolution = selectAgentRuntimeTarget({
    runtimeTargets: dispatchData.runtimeTargets,
    defaultTargetId: typeof dispatchData.defaultRuntimeTarget === 'string' ? dispatchData.defaultRuntimeTarget : undefined,
    preference: preferredRuntimeTarget(options),
    preferLocal: preferLocalRuntime(),
    legacy: {
      baseUrl: typeof dispatchData.baseUrl === 'string' ? dispatchData.baseUrl : raw?.baseUrl,
      apiKey: typeof dispatchData.apiKey === 'string' ? dispatchData.apiKey : legacyApiKey,
      enabled: dispatchData.enabled === false ? false : raw?.enabled,
    },
  })
  if (resolution && 'ok' in resolution) {
    throw new RuntimeTargetResolutionError(resolution)
  }
  return resolution
}

export class RuntimeTargetResolutionError extends Error {
  readonly code: RuntimeTargetSelectionError['code']
  readonly requestedTargetId: string

  constructor(resolution: RuntimeTargetSelectionError) {
    super(`Selected runtime target ${resolution.requestedTargetId} failed: ${resolution.code}`)
    this.name = 'RuntimeTargetResolutionError'
    this.code = resolution.code
    this.requestedTargetId = resolution.requestedTargetId
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** List all agent docs with apiKey masked. */
export async function listAgents(): Promise<AgentTeamDoc[]> {
  const snap = await adminDb.collection(COLLECTION).get()
  return snap.docs.map((d) => toPublicDoc(d.data() as AgentTeamStoredDoc))
}

/** Get a single agent doc with apiKey masked. Returns null if not seeded yet. */
export async function getAgent(agentId: AgentId): Promise<AgentTeamDoc | null> {
  const raw = await getRaw(agentId)
  if (!raw) return null
  return toPublicDoc(raw)
}

/** Return the decrypted (plain-text) apiKey — use only server-side for outbound calls. */
export async function getAgentDecryptedKey(agentId: AgentId): Promise<string | null> {
  const raw = await getRaw(agentId)
  if (!raw) return null
  return decryptAgentApiKey(raw.apiKey)
}

/**
 * Build the Hermes link used by chat/finalizer dispatch through the same
 * runtime-target resolver as admin health/control calls. This keeps unified
 * chat aligned with `agent_dispatch_configs` (including local-vs-VPS routing)
 * instead of relying only on the legacy encrypted `agent_team.apiKey` fields.
 */
export async function getAgentDispatchHermesProfileLink(
  agentId: AgentId,
  orgId: string,
  options: AgentRuntimeCallOptions = {},
): Promise<HermesProfileLink | null> {
  const raw = await getRaw(agentId)
  if (!raw) return null
  const target = await resolveAgentDispatchTarget(agentId, raw, options)
  if (!target) return null
  return {
    orgId,
    profile: agentId,
    baseUrl: target.baseUrl,
    apiKey: target.apiKey,
    enabled: raw.enabled,
    runtimeTargetId: target.targetId,
    runtimeKind: target.runtimeKind,
    machineLabel: target.machineLabel,
    transportIdentity: target.transportIdentity,
    capabilities: { runs: true, dashboard: false, cron: false, models: false, tools: true, files: false, terminal: false },
    permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
  }
}

type UpdateableFields = Partial<
  Pick<AgentTeamDoc, 'enabled' | 'name' | 'role' | 'persona' | 'baseUrl' | 'apiKey' | 'defaultModel' | 'iconKey' | 'colorKey'>
> & Partial<AgentRegistryEntry>

type CreateAgentInput = Pick<AgentTeamDoc, 'agentId' | 'name' | 'role' | 'persona' | 'defaultModel' | 'iconKey' | 'colorKey' | 'enabled' | 'baseUrl'> & {
  apiKey: string
} & Partial<AgentRegistryEntry>

export type CreateLinkedAgentInput = Pick<
  AgentTeamDoc,
  'agentId' | 'name' | 'role' | 'persona' | 'defaultModel' | 'iconKey' | 'colorKey'
  | 'scopeOrgId' | 'agentHandle' | 'createdByUserId' | 'homeDeviceId' | 'accessScope'
> & {
  ownerUserId?: string
  agentKind?: 'custom' | 'marketplace'
  marketplaceTemplateId?: string
  marketplacePack?: 'public'
  marketplaceSkills?: string[]
}

/**
 * Update an agent doc. If `apiKey` is included in the patch it is re-encrypted
 * before write. Also mirrors `endpoint` + `apiKey` (raw) into
 * `agent_dispatch_configs/{agentId}` so the watcher daemon stays in sync.
 *
 * Returns the updated doc with apiKey masked.
 */
export async function updateAgent(agentId: AgentId, patch: UpdateableFields): Promise<AgentTeamDoc> {
  const ref = adminDb.collection(COLLECTION).doc(agentId)
  const existing = await ref.get()
  if (!existing.exists) throw new Error(`agent_team/${agentId} not found`)

  const existingRaw = existing.data() as AgentTeamStoredDoc

  // Build the write payload
  const writePayload: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() }

  let plaintextKey: string | null = null

  for (const [k, v] of Object.entries(patch)) {
    if (k === 'apiKey') {
      const plainKey = v as string
      plaintextKey = plainKey
      writePayload.apiKey = encryptAgentApiKey(plainKey)
    } else if (!['responsibilities', 'skills', 'cronWatchLoops', 'allowedScopes', 'exampleTaskTypes'].includes(k)) {
      writePayload[k] = v
    }
  }

  Object.assign(writePayload, normalizeAgentRegistryInput(patch))

  await ref.update(writePayload)

  // Side-effect: sync agent_dispatch_configs so the watcher daemon picks up changes.
  // The watcher reads `endpoint` (baseUrl + /v1/runs) and `apiKey` (UNENCRYPTED).
  const dispatchPatch: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() }

  if (patch.baseUrl !== undefined) {
    const baseUrl = patch.baseUrl.replace(/\/+$/, '')
    dispatchPatch.baseUrl = baseUrl
    dispatchPatch.endpoint = `${baseUrl}/v1/runs`
    dispatchPatch.runtimeTargets = buildRuntimeTargetMap({
      id: 'vps',
      label: 'VPS Hermes',
      baseUrl,
      enabled: true,
      priority: 10,
      capabilities: ['always-on', 'server-runtime'],
    })
    dispatchPatch.defaultRuntimeTarget = 'vps'
  }

  if (plaintextKey !== null) {
    dispatchPatch.apiKey = plaintextKey
    const existingTargets = dispatchPatch.runtimeTargets as Record<string, Record<string, unknown>> | undefined
    if (existingTargets?.vps) {
      existingTargets.vps.apiKey = plaintextKey
    } else if (existingRaw.baseUrl) {
      dispatchPatch.runtimeTargets = buildRuntimeTargetMap({
        id: 'vps',
        label: 'VPS Hermes',
        baseUrl: existingRaw.baseUrl,
        apiKey: plaintextKey,
        enabled: true,
        priority: 10,
        capabilities: ['always-on', 'server-runtime'],
      })
      dispatchPatch.defaultRuntimeTarget = 'vps'
    }
  }

  if (Object.keys(dispatchPatch).length > 1) {
    await adminDb
      .collection(DISPATCH_COLLECTION)
      .doc(agentId)
      .set(dispatchPatch, { merge: true })
  }

  // Return the fresh doc (with mask)
  const updated = await ref.get()
  return toPublicDoc(updated.data() as AgentTeamStoredDoc)
}

export async function createAgent(input: CreateAgentInput): Promise<AgentTeamDoc> {
  const ref = adminDb.collection(COLLECTION).doc(input.agentId)
  const existing = await ref.get()
  if (existing.exists) throw new Error(`agent_team/${input.agentId} already exists`)

  const now = FieldValue.serverTimestamp()
  const encryptedKey = encryptAgentApiKey(input.apiKey)
  const registry = mergeAgentRegistry(input.agentId, input)
  const skillPolicy = buildAgentSkillPolicyState(input.agentId)
  await ref.set({
    agentId: input.agentId,
    name: input.name,
    role: input.role,
    persona: input.persona,
    defaultModel: input.defaultModel,
    iconKey: input.iconKey,
    colorKey: input.colorKey,
    enabled: input.enabled,
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    apiKey: encryptedKey,
    ...registry,
    ...(skillPolicy ? { skillPolicy } : {}),
    createdAt: now,
    updatedAt: now,
  })

  const baseUrl = input.baseUrl.replace(/\/+$/, '')
  await adminDb.collection(DISPATCH_COLLECTION).doc(input.agentId).set({
    agentId: input.agentId,
    baseUrl,
    endpoint: `${baseUrl}/v1/runs`,
    apiKey: input.apiKey,
    enabled: input.enabled,
    defaultRuntimeTarget: 'vps',
    runtimeTargets: buildRuntimeTargetMap({
      id: 'vps',
      label: 'VPS Hermes',
      baseUrl,
      apiKey: input.apiKey,
      enabled: input.enabled,
      priority: 10,
      capabilities: ['always-on', 'server-runtime'],
    }),
    createdAt: now,
    updatedAt: now,
  }, { merge: true })

  const snap = await ref.get()
  return toPublicDoc(snap.data() as AgentTeamStoredDoc)
}

/**
 * Register an agent whose gateway is provisioned by a signed linked-computer
 * job. It deliberately does not create a platform dispatch target: linked
 * conversation dispatch re-authorizes the selected machine on every run.
 */
export async function createLinkedAgent(input: CreateLinkedAgentInput): Promise<AgentTeamDoc> {
  const ref = adminDb.collection(COLLECTION).doc(input.agentId)
  const now = FieldValue.serverTimestamp()
  const registry = mergeAgentRegistry(input.agentId, {})
  await ref.create({
    agentId: input.agentId,
    name: input.name,
    role: input.role,
    persona: input.persona,
    defaultModel: input.defaultModel,
    iconKey: input.iconKey,
    colorKey: input.colorKey,
    enabled: true,
    baseUrl: '',
    // Linked runtimes mint and retain their own gateway credential. Keep an
    // encrypted non-routable marker so the existing public DTO never exposes
    // or mistakes a linked runtime secret for a platform credential.
    apiKey: encryptAgentApiKey(`linked:${crypto.randomBytes(24).toString('hex')}`),
    ...registry,
    scopeOrgId: input.scopeOrgId,
    agentHandle: input.agentHandle,
    ownerUserId: input.ownerUserId ?? null,
    createdByUserId: input.createdByUserId,
    homeDeviceId: input.homeDeviceId,
    provisioningMode: 'linked_device',
    provisioningStatus: 'installing',
    provisioningError: null,
    accessScope: input.accessScope,
    agentKind: input.agentKind ?? 'custom',
    ...(input.marketplaceTemplateId
      ? {
          marketplaceTemplateId: input.marketplaceTemplateId,
          marketplacePack: input.marketplacePack ?? 'public',
          marketplaceSkills: input.marketplaceSkills ?? [],
        }
      : {}),
    createdAt: now,
    updatedAt: now,
  })

  const snap = await ref.get()
  return toPublicDoc(snap.data() as AgentTeamStoredDoc)
}

/**
 * Get or create a marketplace instance agent for a user or org scope.
 * Idempotent: same scope + template always reuses the same agent id.
 */
export async function ensureMarketplaceAgent(input: {
  templateId: string
  scope: 'user' | 'org'
  scopeId: string
  orgId: string
  createdByUserId: string
  homeDeviceId: string
  accessScope: 'personal' | 'organization'
  ownerUserId?: string
}): Promise<{ agent: AgentTeamDoc; created: boolean }> {
  const { getMarketplaceTemplate, buildMarketplaceAgentId, isMarketplaceTemplateId } = await import(
    '@/lib/agents/marketplace'
  )
  if (!isMarketplaceTemplateId(input.templateId)) {
    throw new Error(`Unknown marketplace template: ${input.templateId}`)
  }
  const template = getMarketplaceTemplate(input.templateId)
  if (!template) throw new Error(`Unknown marketplace template: ${input.templateId}`)

  const agentId = buildMarketplaceAgentId({
    templateId: input.templateId,
    scope: input.scope,
    scopeId: input.scopeId,
  })
  const existing = await getAgent(agentId as AgentId)
  if (existing) {
    return { agent: existing, created: false }
  }

  try {
    const agent = await createLinkedAgent({
      agentId,
      name: template.name,
      role: template.role,
      persona: template.publicPersona,
      defaultModel: 'auto',
      iconKey: template.iconKey,
      colorKey: template.colorKey,
      scopeOrgId: input.orgId,
      agentHandle: `mp-${template.templateId}`,
      createdByUserId: input.createdByUserId,
      homeDeviceId: input.homeDeviceId,
      accessScope: input.accessScope,
      ownerUserId: input.ownerUserId,
      agentKind: 'marketplace',
      marketplaceTemplateId: template.templateId,
      marketplacePack: 'public',
      marketplaceSkills: [...template.publicSkills],
    })
    return { agent, created: true }
  } catch (error) {
    // Concurrent create — re-read.
    const raced = await getAgent(agentId as AgentId)
    if (raced) return { agent: raced, created: false }
    throw error
  }
}

/** Update public-skill selection on a marketplace instance (allowlisted only). */
export async function setMarketplaceAgentSkills(
  agentId: string,
  skills: string[],
): Promise<AgentTeamDoc> {
  const { sanitizeMarketplaceSkills, isMarketplaceAgentId } = await import('@/lib/agents/marketplace')
  if (!isMarketplaceAgentId(agentId)) {
    throw new Error('Only marketplace agents accept skill selection')
  }
  const cleaned = sanitizeMarketplaceSkills(skills)
  if (cleaned.length === 0) {
    throw new Error('Select at least one public marketplace skill')
  }
  const ref = adminDb.collection(COLLECTION).doc(agentId)
  const existing = await ref.get()
  if (!existing.exists) throw new Error(`agent_team/${agentId} not found`)
  const stored = existing.data() as AgentTeamStoredDoc
  if (stored.agentKind !== 'marketplace' && !stored.marketplaceTemplateId) {
    throw new Error('Only marketplace agents accept skill selection')
  }
  await ref.update({
    marketplaceSkills: cleaned,
    marketplacePack: 'public',
    updatedAt: FieldValue.serverTimestamp(),
  })
  const snap = await ref.get()
  return toPublicDoc(snap.data() as AgentTeamStoredDoc)
}

/**
 * Update member/org linked-device agents (name, role, persona, model presentation).
 * Does not touch platform VPS agents or encrypted gateway credentials.
 */
export async function updateLinkedAgent(
  agentId: string,
  patch: Partial<Pick<AgentTeamDoc, 'name' | 'role' | 'persona' | 'defaultModel' | 'iconKey' | 'colorKey'>>,
): Promise<AgentTeamDoc> {
  const ref = adminDb.collection(COLLECTION).doc(agentId)
  const existing = await ref.get()
  if (!existing.exists) throw new Error(`agent_team/${agentId} not found`)
  const stored = existing.data() as AgentTeamStoredDoc
  if (stored.provisioningMode !== 'linked_device') {
    throw new Error('Only linked-device agents can be updated through this path')
  }
  if (stored.agentKind === 'marketplace' || stored.marketplaceTemplateId) {
    throw new Error('Marketplace agents cannot be edited — pull or remove them instead')
  }

  const writePayload: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
  for (const field of ['name', 'role', 'persona', 'defaultModel', 'iconKey', 'colorKey'] as const) {
    if (patch[field] !== undefined) writePayload[field] = patch[field]
  }
  if (Object.keys(writePayload).length === 1) {
    return toPublicDoc(stored)
  }
  await ref.update(writePayload)
  const snap = await ref.get()
  return toPublicDoc(snap.data() as AgentTeamStoredDoc)
}

export async function recordAgentSkillPolicyApplied(
  agentId: AgentId,
  appliedBy: string,
  driftStatus: 'in_sync' | 'drifted' | 'not_applied' = 'in_sync',
): Promise<AgentTeamDoc> {
  const state = buildAgentSkillPolicyState(agentId)
  if (!state) throw new Error(`No skill policy defined for agent '${agentId}'`)

  await adminDb.collection(COLLECTION).doc(agentId).set({
    skillPolicy: {
      ...state,
      appliedAt: FieldValue.serverTimestamp(),
      appliedVersion: state.policyVersion,
      appliedBy,
      driftStatus,
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  const updated = await getRaw(agentId)
  if (!updated) throw new Error(`agent_team/${agentId} not found`)
  return toPublicDoc(updated)
}

/**
 * Ping the agent's /v1/health endpoint and record result.
 * Returns { status, latencyMs }.
 */
export async function pingAgentHealth(
  agentId: AgentId,
): Promise<{ status: 'ok' | 'degraded' | 'unreachable'; latencyMs?: number }> {
  const raw = await getRaw(agentId)
  if (!raw) throw new Error(`agent_team/${agentId} not found`)

  const target = await resolveAgentDispatchTarget(agentId, raw)
  if (!target) return { status: 'unreachable' }
  const healthUrl = `${target.baseUrl}/v1/health`

  const t0 = Date.now()
  let status: 'ok' | 'degraded' | 'unreachable' = 'unreachable'
  let latencyMs: number | undefined

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5_000)
    try {
      const res = await fetch(healthUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${target.apiKey}` },
        signal: controller.signal,
      })
      latencyMs = Date.now() - t0
      status = res.ok ? 'ok' : 'degraded'
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    latencyMs = undefined
    status = 'unreachable'
  }

  // Write health result back to doc
  await adminDb
    .collection(COLLECTION)
    .doc(agentId)
    .update({
      lastHealthCheck: FieldValue.serverTimestamp(),
      lastHealthStatus: status,
    })

  return { status, latencyMs }
}

/**
 * Call a raw path on an agent's Hermes endpoint. Decrypts the apiKey server-side.
 * Used by the agent admin API routes that proxy skills/config/logs.
 */
export async function callAgentPath(
  agentId: AgentId,
  path: string,
  init: RequestInit = {},
  options: AgentRuntimeCallOptions = {},
): Promise<{ response: Response; data: unknown }> {
  const raw = await getRaw(agentId)
  if (!raw) throw new Error(`agent_team/${agentId} not found`)
  const target = await resolveAgentDispatchTarget(agentId, raw, options)
  if (!target) throw new Error(`No reachable runtime target configured for agent_team/${agentId}`)
  const url = `${target.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const existingHeaders = init.headers
    ? (init.headers instanceof Headers
        ? Object.fromEntries((init.headers as unknown as { entries(): Iterable<[string, string]> }).entries())
        : Array.isArray(init.headers)
          ? Object.fromEntries(init.headers as [string, string][])
          : (init.headers as Record<string, string>))
    : {}
  const headers: Record<string, string> = { Authorization: `Bearer ${target.apiKey}`, ...existingHeaders }
  // Bound remote agent calls so chat/provision never hangs to a Vercel 500.
  const timeoutMs = 20_000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  if (init.signal) {
    if (init.signal.aborted) controller.abort()
    else init.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  try {
    const response = await fetch(url, { ...init, headers, signal: controller.signal })
    const text = await response.text()
    let data: unknown = null
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    return { response, data }
  } finally {
    clearTimeout(timeout)
  }
}

/** Like callAgentPath but returns the raw Response for streaming (SSE). */
export async function callAgentStream(
  agentId: AgentId,
  path: string,
  options: AgentRuntimeCallOptions = {},
): Promise<Response> {
  const raw = await getRaw(agentId)
  if (!raw) throw new Error(`agent_team/${agentId} not found`)
  const target = await resolveAgentDispatchTarget(agentId, raw, options)
  if (!target) throw new Error(`No reachable runtime target configured for agent_team/${agentId}`)
  const url = `${target.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${target.apiKey}`,
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
  return response
}
