/**
 * Direct async generation lane for BYOK providers that expose their own
 * queue/status APIs — xAI video and all fal.ai models. Unlike the Higgsfield
 * executor bridge (provider-runtime.ts), these calls go straight from our
 * server to the provider using a resolved BYOK (or platform env) credential.
 *
 * Dependency rule: this module imports from runs.ts, connections/* and store
 * helpers only. It NEVER imports provider-runtime.ts at module load — the drain
 * submit step lazy-imports `dispatchCreativeCanvasRunNow` to avoid a cycle
 * (provider-runtime imports this module for the router).
 */
import { adminDb } from '@/lib/firebase/admin'
import {
  CREATIVE_CANVAS_RUN_COLLECTION,
  completeCreativeCanvasRun,
  refreshCreativeCanvasProviderRunStatus,
} from './runs'
import { getCreativeProviderConnection } from './connections/store'
import { decryptConnectionCredentials } from './connections/crypto'
import { resolveCreativeProviderCredential } from './connections/resolve'
import type {
  CreativeCanvasActor,
  CreativeCanvasOutputKind,
  CreativeCanvasProviderKey,
  CreativeCanvasRun,
} from './types'

type RunWithId = CreativeCanvasRun & { id: string }

const DIRECT_ACTOR: CreativeCanvasActor = { uid: 'agent:maya', type: 'agent' }
const DEFAULT_BATCH_SIZE = 5

export interface DirectCredentials {
  apiKey: string
  [key: string]: string
}

export interface DirectSubmitResult {
  providerJobId: string
  providerStatusUrl?: string
}

export interface DirectPollResult {
  status: 'running' | 'completed' | 'failed'
  output?: {
    kind: CreativeCanvasOutputKind
    url: string
  }
  error?: {
    code: string
    message: string
    retryable: boolean
  }
}

/** fal.ai model id → queue endpoint path (relative to https://queue.fal.run). */
export const FAL_ENDPOINTS: Record<string, string> = {
  'fal-flux-2-pro': 'fal-ai/flux-2-pro',
  'fal-kling-video-2-6-pro': 'fal-ai/kling-video/v2.6/pro/text-to-video',
  'fal-veo-3-1': 'fal-ai/veo3.1',
}

const FAL_QUEUE_BASE = 'https://queue.fal.run'
const XAI_BASE = 'https://api.x.ai/v1'

function safeMessage(value: unknown, fallback: string): string {
  if (!value) return fallback
  if (typeof value === 'string') return value.slice(0, 500)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return safeMessage(obj.message ?? obj.error ?? obj.detail ?? obj.details, fallback)
  }
  return fallback
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

async function submitXaiVideo(run: RunWithId, credentials: DirectCredentials): Promise<DirectSubmitResult> {
  const referenceImageUrl = run.input.referenceImageUrls?.[0]
  const response = await fetch(`${XAI_BASE}/videos/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credentials.apiKey}`,
    },
    body: JSON.stringify({
      model: run.model,
      prompt: run.input.promptSummary ?? '',
      ...(typeof run.input.durationSeconds === 'number' ? { duration: run.input.durationSeconds } : {}),
      ...(run.input.aspectRatio ? { aspect_ratio: run.input.aspectRatio } : {}),
      ...(referenceImageUrl ? { image_url: referenceImageUrl } : {}),
    }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(safeMessage(body, `xAI video submit failed (${response.status})`))
  }
  const requestId = cleanString((body as Record<string, unknown> | null)?.request_id)
  if (!requestId) throw new Error('xAI video submit returned no request_id')
  return { providerJobId: requestId }
}

async function submitFal(run: RunWithId, credentials: DirectCredentials): Promise<DirectSubmitResult> {
  const endpoint = FAL_ENDPOINTS[run.model ?? '']
  if (!endpoint) throw new Error(`Unsupported fal model "${run.model ?? ''}"`)
  const response = await fetch(`${FAL_QUEUE_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${credentials.apiKey}`,
    },
    body: JSON.stringify({
      prompt: run.input.promptSummary ?? '',
      ...(run.input.aspectRatio ? { aspect_ratio: run.input.aspectRatio } : {}),
      ...(typeof run.input.durationSeconds === 'number' ? { duration: run.input.durationSeconds } : {}),
      ...(run.input.referenceImageUrls?.[0] ? { image_url: run.input.referenceImageUrls[0] } : {}),
    }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(safeMessage(body, `fal submit failed (${response.status})`))
  }
  const record = (body as Record<string, unknown> | null) ?? {}
  const requestId = cleanString(record.request_id)
  if (!requestId) throw new Error('fal submit returned no request_id')
  return { providerJobId: requestId, providerStatusUrl: cleanString(record.status_url) }
}

export async function submitDirectRun(run: RunWithId, credentials: DirectCredentials): Promise<DirectSubmitResult> {
  if (run.providerKey === 'xai') return submitXaiVideo(run, credentials)
  if (run.providerKey === 'fal') return submitFal(run, credentials)
  throw new Error(`Direct submit is not supported for provider "${run.providerKey}"`)
}

// ---------------------------------------------------------------------------
// Poll
// ---------------------------------------------------------------------------

/**
 * A definitive auth/not-found poll response (401/403/404) means the key was
 * revoked or the job expired under it — the run can never complete on this
 * credential, so stop polling and fail (retryable: a fresh submit re-resolves).
 * Transient errors (5xx, 429) are left as `running` by the caller.
 */
function terminalPollFailure(provider: string, status: number): DirectPollResult {
  return {
    status: 'failed',
    error: {
      code: `${provider}_poll_unauthorized`,
      message: `Provider rejected the poll (${status}) — the key may have been revoked or the job expired`,
      retryable: true,
    },
  }
}

async function pollXaiVideo(run: RunWithId, credentials: DirectCredentials): Promise<DirectPollResult> {
  const jobId = run.provenance.providerJobId
  if (!jobId) return { status: 'running' }
  const response = await fetch(`${XAI_BASE}/videos/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${credentials.apiKey}` },
  })
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return terminalPollFailure('xai', response.status)
  }
  if (!response.ok) return { status: 'running' }
  const status = cleanString(body?.status)?.toLowerCase()
  if (status === 'completed' || status === 'succeeded' || status === 'success') {
    const url = cleanString((body?.video as Record<string, unknown> | undefined)?.url) ?? cleanString(body?.url)
    if (!url) {
      return { status: 'failed', error: { code: 'xai_missing_output', message: 'xAI reported completion without a video URL.', retryable: true } }
    }
    return { status: 'completed', output: { kind: 'video', url } }
  }
  if (status === 'failed' || status === 'error') {
    return { status: 'failed', error: { code: 'xai_generation_failed', message: safeMessage(body?.error ?? body, 'xAI video generation failed.'), retryable: false } }
  }
  return { status: 'running' }
}

async function pollFal(run: RunWithId, credentials: DirectCredentials): Promise<DirectPollResult> {
  const endpoint = FAL_ENDPOINTS[run.model ?? '']
  const jobId = run.provenance.providerJobId
  if (!endpoint || !jobId) return { status: 'running' }
  const statusUrl = cleanString(run.provenance.providerStatusUrl)
    ?? `${FAL_QUEUE_BASE}/${endpoint}/requests/${jobId}/status`
  const statusResponse = await fetch(statusUrl, {
    headers: { Authorization: `Key ${credentials.apiKey}` },
  })
  const statusBody = (await statusResponse.json().catch(() => null)) as Record<string, unknown> | null
  if (statusResponse.status === 401 || statusResponse.status === 403 || statusResponse.status === 404) {
    return terminalPollFailure('fal', statusResponse.status)
  }
  if (!statusResponse.ok) return { status: 'running' }
  const status = cleanString(statusBody?.status)?.toUpperCase()

  if (status === 'FAILED' || status === 'ERROR') {
    return { status: 'failed', error: { code: 'fal_generation_failed', message: safeMessage(statusBody?.detail ?? statusBody?.error ?? statusBody, 'fal generation failed.'), retryable: false } }
  }
  if (status !== 'COMPLETED') return { status: 'running' }

  const resultResponse = await fetch(`${FAL_QUEUE_BASE}/${endpoint}/requests/${jobId}`, {
    headers: { Authorization: `Key ${credentials.apiKey}` },
  })
  if (resultResponse.status === 401 || resultResponse.status === 403 || resultResponse.status === 404) {
    return terminalPollFailure('fal', resultResponse.status)
  }
  const resultBody = (await resultResponse.json().catch(() => null)) as Record<string, unknown> | null
  if (!resultResponse.ok || !resultBody) {
    return { status: 'failed', error: { code: 'fal_missing_output', message: 'fal reported completion but the result could not be fetched.', retryable: true } }
  }
  const videoUrl = cleanString((resultBody.video as Record<string, unknown> | undefined)?.url)
  if (videoUrl) return { status: 'completed', output: { kind: 'video', url: videoUrl } }
  const images = Array.isArray(resultBody.images) ? resultBody.images as Array<Record<string, unknown>> : []
  const imageUrl = cleanString(images[0]?.url)
  if (imageUrl) return { status: 'completed', output: { kind: 'image', url: imageUrl } }
  return { status: 'failed', error: { code: 'fal_missing_output', message: 'fal completed without a media URL.', retryable: true } }
}

export async function pollDirectRun(run: RunWithId, credentials: DirectCredentials): Promise<DirectPollResult> {
  if (run.providerKey === 'xai') return pollXaiVideo(run, credentials)
  if (run.providerKey === 'fal') return pollFal(run, credentials)
  throw new Error(`Direct poll is not supported for provider "${run.providerKey}"`)
}

// ---------------------------------------------------------------------------
// Drain (cron)
// ---------------------------------------------------------------------------

const DIRECT_PROVIDERS: CreativeCanvasProviderKey[] = ['xai', 'fal']

async function listDirectRunsByStatus(status: string, limit: number): Promise<RunWithId[]> {
  const snap = await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION)
    .where('providerKey', 'in', DIRECT_PROVIDERS)
    .where('status', '==', status)
    .limit(limit)
    .get()
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as CreativeCanvasRun) }))
}

/**
 * Outcome of resolving the credential a running direct run should poll with.
 * `connection_lost` is deliberately distinct from `none`: when the run recorded
 * a specific BYOK connection that is no longer usable, we must NOT substitute
 * any other key — the provider job only exists under the original account, so
 * polling with a different key would query a job that doesn't exist there and
 * leave the run stuck forever. We fail the run instead.
 */
export type PollCredentialResolution =
  | { kind: 'ok'; credentials: DirectCredentials }
  | { kind: 'connection_lost'; message: string }
  | { kind: 'none' }

const CONNECTION_LOST_MESSAGE =
  'The account used for this run was disconnected — reconnect it or retry the generation.'

/**
 * Resolve the credential a running direct run should poll with.
 * - `connectionId` set + connection usable → `ok`.
 * - `connectionId` set + NOT usable (missing / revoked / decrypt fails) →
 *   `connection_lost` (do NOT fall back to another key — see type doc).
 * - no `connectionId` (shared-env submits, legacy) → org/env fallback chain →
 *   `ok` or `none`.
 */
async function resolvePollCredentials(run: RunWithId): Promise<PollCredentialResolution> {
  const connectionId = cleanString(run.provenance.connectionId)
  if (connectionId) {
    const conn = await getCreativeProviderConnection(connectionId)
    if (conn && conn.status === 'connected' && conn.credentialsEnc) {
      try {
        const creds = decryptConnectionCredentials(conn.credentialsEnc, conn.scopeKeyRef)
        if (creds.apiKey) return { kind: 'ok', credentials: creds as DirectCredentials }
      } catch {
        // Decrypt failed (e.g. rotated master key) — the recorded connection is
        // no longer usable. Fail loudly rather than polling under another key.
      }
    }
    return { kind: 'connection_lost', message: CONNECTION_LOST_MESSAGE }
  }
  const resolved = await resolveCreativeProviderCredential({ provider: run.providerKey, orgId: run.orgId, uid: '' })
  if (resolved.kind === 'byok' && resolved.credentials.apiKey) {
    return { kind: 'ok', credentials: resolved.credentials as DirectCredentials }
  }
  if (run.providerKey === 'xai' && process.env.XAI_API_KEY?.trim()) {
    return { kind: 'ok', credentials: { apiKey: process.env.XAI_API_KEY.trim() } }
  }
  return { kind: 'none' }
}

async function applyPollResult(run: RunWithId, result: DirectPollResult): Promise<'completed' | 'failed' | 'refreshed'> {
  if (result.status === 'completed' && result.output) {
    await completeCreativeCanvasRun(run.id, run.orgId, {
      outputNodeId: `${run.nodeId}-output`,
      output: {
        kind: result.output.kind,
        url: result.output.url,
        rawProviderJobId: run.provenance.providerJobId,
      },
      provenance: {
        providerJobId: run.provenance.providerJobId,
        costLabel: `${run.providerKey}_direct`,
      },
    }, DIRECT_ACTOR)
    return 'completed'
  }
  if (result.status === 'failed') {
    await refreshCreativeCanvasProviderRunStatus(run.id, run.orgId, {
      status: 'failed',
      providerStatus: result.error?.code,
      providerStatusMessage: result.error?.message,
      error: result.error,
    }, DIRECT_ACTOR)
    return 'failed'
  }
  await refreshCreativeCanvasProviderRunStatus(run.id, run.orgId, {
    status: 'running',
    providerStatus: 'direct_poll',
    providerStatusMessage: 'Direct provider job is still processing.',
  }, DIRECT_ACTOR)
  return 'refreshed'
}

export async function drainDirectCreativeCanvasRuns(options: {
  submitLimit?: number
  pollLimit?: number
} = {}): Promise<{ submitted: number; polled: number; completed: number; failed: number; skipped: number }> {
  let submitted = 0
  let polled = 0
  let completed = 0
  let failed = 0
  let skipped = 0

  // Lazy import avoids the provider-runtime ↔ direct-provider-runtime cycle.
  const { dispatchCreativeCanvasRunNow } = await import('./provider-runtime')

  const queuedRuns = await listDirectRunsByStatus('queued', options.submitLimit ?? DEFAULT_BATCH_SIZE)
  for (const run of queuedRuns) {
    // Isolate each run: one bad submit must not abort the whole batch.
    try {
      const outcome = await dispatchCreativeCanvasRunNow(run, {})
      if (outcome === 'submitted') submitted++
      if (outcome === 'completed') completed++
      if (outcome === 'failed') failed++
    } catch (err) {
      skipped++
      console.error(`[direct-drain] submit dispatch failed for run ${run.id}`, err)
    }
  }

  const runningRuns = await listDirectRunsByStatus('running', options.pollLimit ?? DEFAULT_BATCH_SIZE)
  for (const run of runningRuns) {
    // Isolate each run: one bad poll/apply must not abort the whole batch.
    try {
      const resolution = await resolvePollCredentials(run)
      if (resolution.kind === 'connection_lost') {
        await refreshCreativeCanvasProviderRunStatus(run.id, run.orgId, {
          status: 'failed',
          providerStatus: 'connection_lost',
          providerStatusMessage: resolution.message,
          error: { code: 'connection_lost', message: resolution.message, retryable: true },
        }, DIRECT_ACTOR)
        failed++
        continue
      }
      if (resolution.kind === 'none') {
        const message = 'No usable credential is connected for this provider — connect one and retry the generation.'
        await refreshCreativeCanvasProviderRunStatus(run.id, run.orgId, {
          status: 'failed',
          providerStatus: 'connection_required',
          providerStatusMessage: message,
          error: { code: 'connection_required', message, retryable: false },
        }, DIRECT_ACTOR)
        failed++
        continue
      }
      const result = await pollDirectRun(run, resolution.credentials)
      const applied = await applyPollResult(run, result)
      if (applied === 'completed') completed++
      else if (applied === 'failed') failed++
      else polled++
    } catch (err) {
      skipped++
      console.error(`[direct-drain] poll/apply failed for run ${run.id}`, err)
    }
  }

  return { submitted, polled, completed, failed, skipped }
}
