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
import type { AgentId, AgentRegistryEntry, AgentTeamDoc, AgentTeamStoredDoc } from './types'

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** List all 5 agent docs with apiKey masked. */
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

type UpdateableFields = Partial<
  Pick<AgentTeamDoc, 'enabled' | 'name' | 'role' | 'persona' | 'baseUrl' | 'apiKey' | 'defaultModel' | 'iconKey' | 'colorKey'>
> & Partial<AgentRegistryEntry>

type CreateAgentInput = Pick<AgentTeamDoc, 'agentId' | 'name' | 'role' | 'persona' | 'defaultModel' | 'iconKey' | 'colorKey' | 'enabled' | 'baseUrl'> & {
  apiKey: string
} & Partial<AgentRegistryEntry>

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

  // Build the write payload
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dispatchPatch: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() }

  if (patch.baseUrl !== undefined) {
    const baseUrl = patch.baseUrl.replace(/\/+$/, '')
    dispatchPatch.baseUrl = baseUrl
    dispatchPatch.endpoint = `${baseUrl}/v1/runs`
  }

  if (plaintextKey !== null) {
    dispatchPatch.apiKey = plaintextKey
  }

  if (Object.keys(dispatchPatch).length > 1) {
    await adminDb
      .collection('agent_dispatch_configs')
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
  await adminDb.collection('agent_dispatch_configs').doc(input.agentId).set({
    agentId: input.agentId,
    baseUrl,
    endpoint: `${baseUrl}/v1/runs`,
    apiKey: input.apiKey,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now,
  }, { merge: true })

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

  const baseUrl = raw.baseUrl.replace(/\/+$/, '')
  const healthUrl = `${baseUrl}/v1/health`

  let plainKey: string
  try {
    plainKey = decryptAgentApiKey(raw.apiKey)
  } catch {
    return { status: 'unreachable' }
  }

  const t0 = Date.now()
  let status: 'ok' | 'degraded' | 'unreachable' = 'unreachable'
  let latencyMs: number | undefined

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5_000)
    try {
      const res = await fetch(healthUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${plainKey}` },
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
): Promise<{ response: Response; data: unknown }> {
  const raw = await getRaw(agentId)
  if (!raw) throw new Error(`agent_team/${agentId} not found`)
  const apiKey = decryptAgentApiKey(raw.apiKey).trim()
  const baseUrl = raw.baseUrl.replace(/\/+$/, '')
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const existingHeaders = init.headers
    ? (init.headers instanceof Headers
        ? Object.fromEntries((init.headers as unknown as { entries(): Iterable<[string, string]> }).entries())
        : Array.isArray(init.headers)
          ? Object.fromEntries(init.headers as [string, string][])
          : (init.headers as Record<string, string>))
    : {}
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, ...existingHeaders }
  const response = await fetch(url, { ...init, headers })
  const text = await response.text()
  let data: unknown = null
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { response, data }
}

/** Like callAgentPath but returns the raw Response for streaming (SSE). */
export async function callAgentStream(agentId: AgentId, path: string): Promise<Response> {
  const raw = await getRaw(agentId)
  if (!raw) throw new Error(`agent_team/${agentId} not found`)
  const apiKey = decryptAgentApiKey(raw.apiKey).trim()
  const baseUrl = raw.baseUrl.replace(/\/+$/, '')
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  return response
}
