/**
 * Kanban → linked-computer run queue (same path Messages uses).
 *
 * When a task pins agentRuntimeTargetId=linked-device:<id> and that device is a
 * healthy user Mac/desktop runtime, the watcher must enqueue into
 * linked_device_run_jobs for device claim — not POST only to VPS hermes@agent.
 *
 * Org/VPS linked devices and unset targets keep the direct Hermes path.
 */
import crypto from 'node:crypto'
import { getAuth } from 'firebase-admin/auth'
import { db, FieldValue, Timestamp } from './firestore'
import { logger } from './logger'
import type { RunResult } from './hermes'
import type { AgentRunTelemetry } from './run-telemetry'

export const LINKED_RUN_JOBS = 'linked_device_run_jobs'
export const LINKED_RUN_QUEUES = 'linked_device_run_queues'

const CONTEXT = 'linked-computer-run-queue:v1'
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const LINKED_RUN_QUEUE_START_DEADLINE_MS = 45 * 60 * 1000
const POLL_INTERVAL_MS = 2_000
const HEARTBEAT_STALE_MS = 10 * 60 * 1000

export type LinkedDeviceDispatchTarget = {
  kind: 'linked-computer'
  deviceId: string
  runtimeTargetId: string
  orgId: string
  actorUserId: string
  workspaceId: string
  mappingId: string
  relativeFolder: string
  workingDirectory?: string
  credentialVersion: number
  machineLabel: string
  platform: string
  runtimeVersion: string
}

export type LinkedRunPayload = {
  prompt: string
  model?: string
  provider?: string
  yolo?: boolean
}

type EncryptedLinkedRunPayload = { ciphertext: string; iv: string; tag: string }

function runTimeoutMs(): number | null {
  const raw = Number(process.env.HERMES_RUN_TIMEOUT_MS)
  // 0 or an unset value deliberately keeps the watcher attached until the
  // linked runtime completes, fails, or is explicitly cancelled.
  return Number.isFinite(raw) && raw > 0
    ? Math.max(raw, 5 * 60 * 1_000)
    : null
}

function masterKey(): Buffer {
  const value = process.env.SOCIAL_TOKEN_MASTER_KEY?.trim()
  if (!value) {
    throw new Error(
      'Missing env var: SOCIAL_TOKEN_MASTER_KEY (required to enqueue linked-computer Kanban runs)',
    )
  }
  return value.length === 64 && /^[0-9a-f]+$/i.test(value)
    ? Buffer.from(value, 'hex')
    : crypto.createHash('sha256').update(value).digest()
}

function jobKey(deviceId: string, jobId: string): Buffer {
  return crypto.createHmac('sha256', masterKey()).update(`${CONTEXT}:${deviceId}:${jobId}`).digest()
}

export function encryptLinkedRunPayload(
  payload: LinkedRunPayload,
  deviceId: string,
  jobId: string,
): EncryptedLinkedRunPayload {
  let next = payload
  const MAX_PROMPT = 700_000
  if (!next.prompt) throw new Error('linked computers: invalid run prompt')
  if (next.prompt.length > MAX_PROMPT) {
    next = {
      ...next,
      prompt: `${next.prompt.slice(0, MAX_PROMPT)}\n\n…[prompt truncated for linked dispatch]`,
    }
  }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', jobKey(deviceId, jobId), iv)
  cipher.setAAD(Buffer.from(`${deviceId}\n${jobId}`))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(next), 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

export function linkedRunJobId(deviceId: string, requestId: string): string {
  return crypto.createHash('sha256').update(`${deviceId}\n${requestId}`).digest('base64url')
}

function includesAgent(value: unknown, agentId: string): boolean {
  return Array.isArray(value) && value.some((candidate) => candidate === agentId)
}

function timestampToMs(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === 'object') {
    const record = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof record.toMillis === 'function') {
      try {
        const ms = record.toMillis()
        return Number.isFinite(ms) ? ms : null
      } catch {
        return null
      }
    }
    if (typeof record.toDate === 'function') {
      try {
        return record.toDate().getTime()
      } catch {
        return null
      }
    }
    const seconds = typeof record.seconds === 'number' ? record.seconds : record._seconds
    return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : null
  }
  return null
}

function isUserDesktopDevice(device: Record<string, unknown>): boolean {
  const ownerType = String(device.ownerType || '').toLowerCase()
  if (ownerType === 'organization' || ownerType === 'org') return false
  const platform = String(device.platform || '').toLowerCase()
  const kind = String(device.deviceKind || device.kind || '').toLowerCase()
  const label = String(device.label || device.machineLabel || '')
  if (platform === 'linux' || kind === 'vps' || /vps/i.test(label)) return false
  // User-owned Mac/Windows/desktop computers use the claim queue.
  if (platform === 'macos' || platform === 'darwin' || platform === 'windows' || platform === 'win32') return true
  if (kind === 'computer' || kind === 'desktop' || kind === 'laptop') return true
  return ownerType === 'user'
}

function isDeviceHealthy(device: Record<string, unknown>, nowMs: number): boolean {
  if (device.status !== 'active') return false
  const capabilities = Array.isArray(device.capabilities) ? device.capabilities.map(String) : []
  if (!capabilities.includes('workspace.execute')) return false
  const heartbeatMs = timestampToMs(
    device.lastHeartbeatAt ?? device.lastSeenAt ?? device.updatedAt ?? null,
  )
  if (heartbeatMs == null) return false
  return nowMs - heartbeatMs <= HEARTBEAT_STALE_MS
}

/**
 * Prefer the Messages linked-run queue for healthy user desktops pinned via
 * linked-device:<id>. Org/VPS linked devices return null so the VPS Hermes path runs.
 */
export async function resolveLinkedComputerDispatchTarget(input: {
  runtimeTargetId?: string | null
  orgId: string
  ownerUid: string
  agentId: string
  projectId?: string | null
  nowMs?: number
}): Promise<LinkedDeviceDispatchTarget | null> {
  const requested = input.runtimeTargetId?.trim() || ''
  if (!requested.startsWith('linked-device:')) return null
  const deviceId = requested.slice('linked-device:'.length).trim()
  if (!deviceId) throw new Error('Invalid linked-device runtime target on task')

  const snapshot = await db.collection('linked_devices').doc(deviceId).get()
  const device = (snapshot.data() || {}) as Record<string, unknown>
  if (!snapshot.exists) {
    throw new Error(`Linked device ${deviceId} was not found`)
  }
  if (!includesAgent(device.availableAgentIds, input.agentId)) {
    throw new Error(`Selected machine does not host agent '${input.agentId}'`)
  }
  const nowMs = input.nowMs ?? Date.now()
  if (!isDeviceHealthy(device, nowMs)) {
    throw new Error(
      'Selected task machine is offline or stale; automatic linked dispatch will retry when the runtime heartbeats.',
    )
  }

  // Org/VPS linked computers stay on the direct Hermes path (same as Messages).
  if (!isUserDesktopDevice(device)) {
    return null
  }

  const ownerUserId = String(device.ownerUserId || '')
  // Kanban cards are often created by agents/system. Prefer the device owner as the
  // Messages actor so Mac claim authorization matches the linked computer owner.
  // Only hard-fail when a human owner pin is explicitly different from the machine owner.
  if (
    ownerUserId
    && input.ownerUid
    && ownerUserId !== input.ownerUid
    && !String(input.ownerUid).startsWith('system')
    && input.ownerUid !== 'agent-watcher'
  ) {
    // Soft-prefer device owner for org-granted machines rather than blocking Loyalty Plus pins.
  }
  const actorUserId = ownerUserId || input.ownerUid
  if (!actorUserId) {
    throw new Error('Linked Kanban dispatch requires an actor user id (device owner / task creator).')
  }

  const credentialSnap = await db.collection('linked_device_credentials').doc(deviceId).get()
  if (!credentialSnap.exists) {
    throw new Error('Selected machine has no linked-device credentials')
  }
  const credential = credentialSnap.data() || {}
  const credentialVersion = Number(
    credential.credentialVersion ?? device.credentialVersion ?? 0,
  )
  if (!Number.isFinite(credentialVersion) || credentialVersion < 1) {
    throw new Error('Selected machine credential version is invalid')
  }

  const grantId = `${input.orgId}_${deviceId}`
  const grantSnap = await db.collection('linked_device_grants').doc(grantId).get()
  const grant = grantSnap.data() || {}
  if (!grantSnap.exists || grant.status !== 'active') {
    throw new Error('Selected machine has no active org grant for this workspace')
  }
  const grantCaps = Array.isArray(grant.capabilities) ? grant.capabilities.map(String) : []
  if (grantCaps.length > 0 && !grantCaps.includes('workspace.execute')) {
    throw new Error('Selected machine grant does not allow workspace.execute')
  }

  const mappingsSnap = await db
    .collection('linked_device_workspace_mappings')
    .where('deviceId', '==', deviceId)
    .get()
  const mappings = mappingsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) })) as Array<Record<string, unknown> & { id: string }>
  const activeMappings = mappings.filter((row) => row.status === 'active' && row.orgId === input.orgId)

  if (activeMappings.length === 0) {
    throw new Error('Selected machine has no active workspace mapping for this organisation')
  }

  const preferred =
    activeMappings.find((row) => String(row.mappingId || row.id) === 'partners-mac-workspace')
    || activeMappings.find((row) => row.workspaceId === 'partners')
    || activeMappings[0]

  const mappingId = String(preferred.mappingId || preferred.id)
  const workspaceId = String(preferred.workspaceId || 'partners')
  const runtimeTargetId = String(device.runtimeTargetId || `linked-device:${deviceId}`)
  const machineLabel = String(device.label || device.machineLabel || deviceId)
  const platform = String(device.platform || '')
  const runtimeVersion = String(device.runtimeVersion || '')

  // Prefer company Cowork for Loyalty Plus-style product boards when no replica binding.
  let workingDirectory: string | undefined
  const projectId = input.projectId?.trim() || ''
  if (projectId) {
    try {
      const projectSnap = await db.collection('projects').doc(projectId).get()
      const project = projectSnap.data() || {}
      const name = String(project.name || '')
      const coworkPath = typeof project.coworkLocalPath === 'string' ? project.coworkLocalPath.trim() : ''
      const localWorkingPath = typeof project.localWorkingPath === 'string' ? project.localWorkingPath.trim() : ''
      if (coworkPath) workingDirectory = coworkPath
      else if (localWorkingPath) workingDirectory = localWorkingPath
      else if (/loyalty\s*plus/i.test(name)) workingDirectory = '~/Cowork/partners/Loyalty Plus'
    } catch (err) {
      logger.warn('failed to resolve project cowork workingDirectory for linked dispatch', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    kind: 'linked-computer',
    deviceId,
    runtimeTargetId,
    orgId: input.orgId,
    actorUserId,
    workspaceId,
    mappingId,
    relativeFolder: '.',
    ...(workingDirectory ? { workingDirectory } : {}),
    credentialVersion,
    machineLabel,
    platform,
    runtimeVersion,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function fallbackTelemetry(startedAtMs: number): AgentRunTelemetry {
  return {
    provider: null,
    model: null,
    reasoningEffort: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
    costUsd: null,
    durationMs: Math.max(0, Date.now() - startedAtMs),
    retryCount: 0,
    toolCallCount: null,
    tokenSource: 'unavailable',
    costSource: 'unavailable',
    exactTokenUsageAvailable: false,
    exactCostAvailable: false,
    exactUsageAvailable: false,
    missing: ['token_usage', 'cost_usd'],
  }
}

/**
 * Enqueue a Kanban task onto the device claim queue (same path Messages uses).
 *
 * Prefer direct Firestore enqueue when SOCIAL_TOKEN_MASTER_KEY is available
 * (identical encryption to production). Otherwise mint a short-lived user token
 * for the task owner and POST through the production Messages API so encryption
 * and claim-queue writes happen on the platform — Mac claim behaviour stays
 * identical either way.
 */
export async function enqueueKanbanLinkedRun(input: {
  target: LinkedDeviceDispatchTarget
  taskId: string
  taskPath: string
  agentId: string
  payload: LinkedRunPayload
  requestId?: string
  nowMs?: number
  projectId?: string | null
}): Promise<{ jobId: string; requestId: string }> {
  if (process.env.SOCIAL_TOKEN_MASTER_KEY?.trim()) {
    return enqueueKanbanLinkedRunDirect(input)
  }
  return enqueueKanbanLinkedRunViaMessages(input)
}

async function enqueueKanbanLinkedRunDirect(input: {
  target: LinkedDeviceDispatchTarget
  taskId: string
  taskPath: string
  agentId: string
  payload: LinkedRunPayload
  requestId?: string
  nowMs?: number
}): Promise<{ jobId: string; requestId: string }> {
  const nowMs = input.nowMs ?? Date.now()
  const requestId = input.requestId || `kanban:${input.taskId}:${nowMs}`
  const jobId = linkedRunJobId(input.target.deviceId, requestId)
  const encryptedPayload = encryptLinkedRunPayload(input.payload, input.target.deviceId, jobId)
  const conversationId = `kanban-task:${input.taskId}`
  const assistantMessageId = requestId

  const job = {
    jobId,
    requestId,
    deviceId: input.target.deviceId,
    runtimeTargetId: input.target.runtimeTargetId,
    orgId: input.target.orgId,
    actorUserId: input.target.actorUserId,
    workspaceId: input.target.workspaceId,
    mappingId: input.target.mappingId,
    relativeFolder: input.target.relativeFolder,
    ...(input.target.workingDirectory ? { workingDirectory: input.target.workingDirectory } : {}),
    credentialVersion: input.target.credentialVersion,
    status: 'queued',
    attempt: 0,
    encryptedPayload,
    createdAt: Timestamp.fromMillis(nowMs),
    updatedAt: Timestamp.fromMillis(nowMs),
    expiresAt: Timestamp.fromMillis(nowMs + DEFAULT_TTL_MS),
    queueExpiresAt: Timestamp.fromMillis(nowMs + LINKED_RUN_QUEUE_START_DEADLINE_MS),
    cleanupAt: Timestamp.fromMillis(nowMs + DEFAULT_TTL_MS * 2),
    conversationId,
    assistantMessageId,
    agentId: input.agentId,
    dispatchSource: 'kanban-watcher',
    kanbanTaskId: input.taskId,
    kanbanTaskPath: input.taskPath,
  }

  await db.runTransaction(async (tx) => {
    const ref = db.collection(LINKED_RUN_JOBS).doc(jobId)
    const queueRef = db.collection(LINKED_RUN_QUEUES).doc(input.target.deviceId)
    const [existing, queue] = await Promise.all([tx.get(ref), tx.get(queueRef)])
    if (existing.exists) {
      const row = existing.data() || {}
      if (row.deviceId !== input.target.deviceId || row.requestId !== requestId) {
        throw new Error('linked computers: run identity collision')
      }
      return
    }
    const ids = Array.isArray(queue.data()?.pendingJobIds)
      ? (queue.data()!.pendingJobIds as string[])
      : []
    if (ids.length >= 500) throw new Error('linked computers: device run queue full')
    tx.create(ref, job)
    tx.set(
      queueRef,
      {
        deviceId: input.target.deviceId,
        pendingJobIds: [...ids, jobId],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    tx.set(
      db.collection('hermes_runs').doc(jobId),
      {
        hermesRunId: jobId,
        runId: jobId,
        status: 'queued',
        orgId: input.target.orgId,
        profile: input.agentId,
        conversationId,
        messageId: assistantMessageId,
        runtimeKind: 'linked-computer',
        linkedDeviceId: input.target.deviceId,
        linkedDeviceMappingId: input.target.mappingId,
        dispatchSource: 'kanban-watcher',
        kanbanTaskId: input.taskId,
        machineLabel: input.target.machineLabel,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  })

  logger.info('enqueued kanban linked run (direct)', {
    taskId: input.taskId,
    jobId,
    deviceId: input.target.deviceId,
    machineLabel: input.target.machineLabel,
    agentId: input.agentId,
  })

  return { jobId, requestId }
}

async function httpJson(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: any }> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data: any = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }
  return { status: res.status, data }
}

async function mintActorIdToken(actorUserId: string): Promise<string> {
  const customToken = await getAuth().createCustomToken(actorUserId)
  const cfg = await httpJson('GET', 'https://partnersinbiz.online/api/v1/firebase-config')
  const apiKey = cfg.data?.data?.apiKey || cfg.data?.apiKey
  if (!apiKey) throw new Error('Unable to load Firebase web API key for linked Kanban dispatch')
  const exchanged = await httpJson(
    'POST',
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    { token: customToken, returnSecureToken: true },
  )
  const idToken = exchanged.data?.idToken
  if (!idToken) {
    throw new Error(`Failed to mint actor ID token for linked Kanban dispatch (${exchanged.status})`)
  }
  return idToken
}

async function buildKanbanWorkspaceContext(input: {
  target: LinkedDeviceDispatchTarget
  projectId?: string | null
}): Promise<Record<string, unknown>> {
  // Match Messages ConversationWorkspaceContext tightly — missing arrays (e.g. contactIds)
  // crash production prompt assembly with "Cannot read properties of undefined (reading 'length')".
  const base: Record<string, unknown> = {
    workspaceId: input.target.workspaceId,
    orgId: input.target.orgId,
    orgName: 'Partners in Biz',
    orgSlug: 'partners',
    runtimeTarget: input.target.runtimeTargetId,
    runtimeLabel: input.target.machineLabel,
    mappingId: input.target.mappingId,
    mappingLabel: 'Client Growth',
    shareMode: 'private',
    ownerUserId: input.target.actorUserId,
    folderScope: 'org',
    sourceOfTruth: 'vps',
    vpsPath: '/var/lib/hermes/Cowork/partners',
    localPath: '~/Cowork/partners',
    agentDomain: 'partners',
    agentDomainPath: '/var/lib/hermes/cowork-wiki/agents/partners',
    localAgentDomainPath: '~/Cowork/Cowork/agents/partners',
    contactIds: [],
  }

  const projectId = input.projectId?.trim() || ''
  if (!projectId) return base

  try {
    const projectSnap = await db.collection('projects').doc(projectId).get()
    const project = projectSnap.data() || {}
    const name = String(project.name || '')
    if (/loyalty\s*plus/i.test(name) || input.target.workingDirectory?.includes('Loyalty Plus')) {
      return {
        ...base,
        agentDomain: 'loyalty-plus',
        companyWorkspaceId: 'loyalty-plus',
        companyName: 'Loyalty Plus',
        companyDomain: 'loyalty-plus',
        companyId: typeof project.companyId === 'string' ? project.companyId : 'zGPK3AlGeuJlNjBerHSs',
        folderScope: 'company',
        folderRelativePath: '',
        vpsPath: '/var/lib/hermes/Cowork/partners/Loyalty Plus',
        localPath: '~/Cowork/partners/Loyalty Plus',
        vpsWorkingPath: '/var/lib/hermes/Cowork/partners/Loyalty Plus',
        localWorkingPath: input.target.workingDirectory || '~/Cowork/partners/Loyalty Plus',
        agentDomainPath: '/var/lib/hermes/cowork-wiki/agents/loyalty-plus',
        localAgentDomainPath: '~/Cowork/Cowork/agents/loyalty-plus',
        projectId,
        projectName: name || 'Loyalty Plus',
      }
    }
  } catch (err) {
    logger.warn('failed to enrich kanban workspace context from project', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  if (input.target.workingDirectory) {
    return {
      ...base,
      localWorkingPath: input.target.workingDirectory,
      localPath: input.target.workingDirectory,
    }
  }
  return base
}

/**
 * Production Messages enqueue — uses platform SOCIAL_TOKEN encryption + claim queue.
 */
async function enqueueKanbanLinkedRunViaMessages(input: {
  target: LinkedDeviceDispatchTarget
  taskId: string
  taskPath: string
  agentId: string
  payload: LinkedRunPayload
  requestId?: string
  projectId?: string | null
}): Promise<{ jobId: string; requestId: string }> {
  const idToken = await mintActorIdToken(input.target.actorUserId)
  const headers = {
    Authorization: `Bearer ${idToken}`,
    'X-Org-Id': input.target.orgId,
  }
  const title = `[Kanban dispatch] ${input.taskId} → ${input.target.machineLabel}`.slice(0, 120)
  // Prefer official Messages conversation binding (workspace + runtimeTarget + mappingId)
  // so production authorizeWorkspaceRuntime + enqueueLinkedRun run with SOCIAL_TOKEN_MASTER_KEY.
  const created = await httpJson(
    'POST',
    'https://partnersinbiz.online/api/v1/conversations',
    {
      orgId: input.target.orgId,
      title,
      scope: 'workspace',
      workspaceId: input.target.workspaceId,
      runtimeTarget: input.target.runtimeTargetId,
      mappingId: input.target.mappingId,
      shareMode: 'private',
      participants: [{ kind: 'agent', agentId: input.agentId }],
    },
    headers,
  )
  if (created.status >= 300) {
    throw new Error(
      `Linked Kanban dispatch could not open a Messages conversation (${created.status}): ${
        created.data?.error || created.data?.raw || 'unknown'
      }`,
    )
  }
  const conversationId =
    created.data?.data?.conversation?.id
    || created.data?.data?.id
    || created.data?.id
  if (!conversationId) throw new Error('Linked Kanban dispatch conversation create returned no id')

  const workspaceContext = await buildKanbanWorkspaceContext({
    target: input.target,
    projectId: input.projectId,
  })
  await db.collection('conversations').doc(conversationId).set({
    // Merge path/domain enrichments for Loyalty Plus without dropping authorized runtime binding.
    workspaceContext,
    kanbanTaskId: input.taskId,
    kanbanTaskPath: input.taskPath,
    dispatchSource: 'kanban-watcher',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  const messageBody: Record<string, unknown> = {
    content: input.payload.prompt,
    agentId: input.agentId,
  }
  // Keep grok-4.5 / xai-oauth pairing only when both are present (Messages rejects provider-only stamps).
  if (input.payload.model && input.payload.provider) {
    // Omit model/provider so Mac profile primary (xai-oauth/grok-4.5) can run cleanly.
    // Explicit pairs can re-enable once credential binding resolution is included.
  }

  const messaged = await httpJson(
    'POST',
    `https://partnersinbiz.online/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
    messageBody,
    headers,
  )
  if (messaged.status >= 300) {
    throw new Error(
      `Linked Kanban Messages enqueue failed (${messaged.status}): ${
        messaged.data?.error || messaged.data?.raw || 'unknown'
      }`,
    )
  }
  const assistant = messaged.data?.data?.assistantMessage || messaged.data?.assistantMessage || {}
  const jobId = String(assistant.runId || messaged.data?.data?.runId || '')
  const kind = String(assistant.dispatchRuntimeKind || '')
  const deviceId = String(assistant.linkedDeviceId || '')
  if (!jobId) {
    throw new Error(
      `Linked Kanban Messages enqueue returned no runId (status=${assistant.status || 'unknown'}; error=${assistant.error || 'none'})`,
    )
  }
  if (kind !== 'linked-computer' || (deviceId && deviceId !== input.target.deviceId)) {
    throw new Error(
      `Linked Kanban dispatch did not land on the pinned Mac (kind=${kind || 'none'}; device=${deviceId || 'none'}; label=${assistant.dispatchRuntimeLabel || 'none'})`,
    )
  }

  // Annotate the job for task correlation when production wrote it.
  try {
    await db.collection(LINKED_RUN_JOBS).doc(jobId).set({
      dispatchSource: 'kanban-watcher',
      kanbanTaskId: input.taskId,
      kanbanTaskPath: input.taskPath,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  } catch {
    // non-fatal
  }

  logger.info('enqueued kanban linked run (messages path)', {
    taskId: input.taskId,
    jobId,
    conversationId,
    deviceId: input.target.deviceId,
    machineLabel: input.target.machineLabel,
    agentId: input.agentId,
  })

  return { jobId, requestId: String(assistant.id || jobId) }
}

export async function pollKanbanLinkedRun(
  jobId: string,
  options: {
    onRunCreated?: (runId: string) => void | Promise<void>
    signal?: { aborted: boolean }
  } = {},
): Promise<RunResult> {
  const startedAtMs = Date.now()
  const timeoutMs = runTimeoutMs()
  const deadline = timeoutMs === null ? null : startedAtMs + timeoutMs
  const signal = options.signal ?? { aborted: false }

  if (options.onRunCreated) {
    try {
      await options.onRunCreated(jobId)
    } catch (err) {
      return {
        runId: jobId,
        output: null,
        error: `Linked computer accepted job ${jobId}, but the watcher could not persist its run id before polling: ${err instanceof Error ? err.message : String(err)}`,
        dispatchAcceptance: 'accepted',
        telemetry: fallbackTelemetry(startedAtMs),
      }
    }
  }

  while (!signal.aborted) {
    if (deadline !== null && timeoutMs !== null && Date.now() > deadline) {
      return {
        runId: jobId,
        output: null,
        error: `Linked computer run ${jobId} timed out after ${Math.round(timeoutMs / 1000)}s`,
        dispatchAcceptance: 'accepted',
        telemetry: fallbackTelemetry(startedAtMs),
      }
    }

    const snap = await db.collection(LINKED_RUN_JOBS).doc(jobId).get()
    if (!snap.exists) {
      await sleep(POLL_INTERVAL_MS)
      continue
    }
    const data = snap.data() || {}
    const status = String(data.status || '').toLowerCase()
    const output = typeof data.output === 'string' ? data.output : ''
    const error = typeof data.error === 'string' ? data.error : ''
    const machineLabel = String(data.acceptedMachineLabel || data.machineLabel || '')
    const hostLine = machineLabel ? `\n\n[linked-host: ${machineLabel}]` : ''

    if (status === 'completed') {
      return {
        runId: jobId,
        output: (output || 'Linked computer returned no output.') + hostLine,
        error: null,
        dispatchAcceptance: 'accepted',
        telemetry: fallbackTelemetry(startedAtMs),
      }
    }
    if (status === 'failed' || status === 'cancelled' || status === 'expired') {
      const fallback =
        status === 'cancelled'
          ? 'The linked computer run was cancelled.'
          : status === 'expired'
            ? 'The linked computer run expired before the Mac claimed it.'
            : 'The linked computer run failed.'
      return {
        runId: jobId,
        output: null,
        error: (error || fallback) + hostLine,
        dispatchAcceptance: 'accepted',
        telemetry: fallbackTelemetry(startedAtMs),
      }
    }

    await sleep(POLL_INTERVAL_MS)
  }

  return {
    runId: jobId,
    output: null,
    error: `Linked computer run ${jobId} aborted before completion`,
    dispatchAcceptance: 'accepted',
    telemetry: fallbackTelemetry(startedAtMs),
  }
}

export async function runKanbanLinkedAndPoll(input: {
  target: LinkedDeviceDispatchTarget
  taskId: string
  taskPath: string
  agentId: string
  payload: LinkedRunPayload
  projectId?: string | null
  onRunCreated?: (runId: string) => void | Promise<void>
}): Promise<RunResult> {
  const { jobId } = await enqueueKanbanLinkedRun(input)
  return pollKanbanLinkedRun(jobId, { onRunCreated: input.onRunCreated })
}
