import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { CREATIVE_CANVAS_RUN_COLLECTION, completeCreativeCanvasRun, dispatchCreativeCanvasProviderRun, ensureCreativeCanvasRunOutputNode, refreshCreativeCanvasProviderRunStatus } from './runs'
import { getCreativeCanvas } from './store'
import { buildHiggsfieldExecutionManifest } from './higgsfield-execution'
import type { CreativeCanvas, CreativeCanvasActor, CreativeCanvasOutputKind, CreativeCanvasProviderRuntimeReadiness, CreativeCanvasRun, CreativeCanvasRunStatus } from './types'

const HIGGSFIELD_ACTOR: CreativeCanvasActor = { uid: 'agent:maya', type: 'agent' }
const DEFAULT_BATCH_SIZE = 5

type RunWithId = CreativeCanvasRun & { id: string }

export interface HiggsfieldRuntimeConfig {
  submitUrl?: string
  statusUrlTemplate?: string
  apiKey?: string
  callbackBaseUrl?: string
  webhookSecret?: string
}

interface RuntimeResult {
  providerJobId?: string
  providerRequestId?: string
  providerStatusUrl?: string
  providerCallbackUrl?: string
  status?: CreativeCanvasRunStatus
  providerStatus?: string
  providerStatusMessage?: string
  error?: {
    code: string
    message: string
    retryable: boolean
  }
  output?: {
    kind?: CreativeCanvasOutputKind
    url?: string
    thumbnailUrl?: string
    artifactId?: string
    storagePath?: string
    textPreview?: string
  }
  raw?: unknown
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanOutputKind(value: unknown): CreativeCanvasOutputKind | undefined {
  const allowed: CreativeCanvasOutputKind[] = ['image', 'video', 'audio', 'caption', 'copy', 'blog_draft', 'document_block', 'book_artifact', 'youtube_render', 'campaign_asset', 'social_post_draft']
  return allowed.includes(value as CreativeCanvasOutputKind) ? value as CreativeCanvasOutputKind : undefined
}

function runtimeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HiggsfieldRuntimeConfig {
  const baseUrl = cleanString(env.HIGGSFIELD_RUNTIME_URL)?.replace(/\/$/, '')
  const appUrl = (cleanString(env.NEXT_PUBLIC_APP_URL) ?? cleanString(env.NEXT_PUBLIC_BASE_URL))?.replace(/\/$/, '')
  const internalSubmitUrl = appUrl && cleanString(env.HIGGSFIELD_RUNTIME_API_KEY)
    ? `${appUrl}/api/internal/creative-canvas/higgsfield-runtime`
    : undefined
  return {
    submitUrl: cleanString(env.HIGGSFIELD_RUNTIME_SUBMIT_URL) ?? (baseUrl ? `${baseUrl}/creative-canvas/runs` : undefined) ?? internalSubmitUrl,
    statusUrlTemplate: cleanString(env.HIGGSFIELD_RUNTIME_STATUS_URL) ?? (baseUrl ? `${baseUrl}/creative-canvas/runs/{providerJobId}` : undefined),
    apiKey: cleanString(env.HIGGSFIELD_RUNTIME_API_KEY),
    callbackBaseUrl: appUrl,
    webhookSecret: cleanString(env.HIGGSFIELD_WEBHOOK_SECRET),
  }
}

export function getHiggsfieldRuntimeReadiness(input: {
  canvas?: Pick<CreativeCanvas, 'linked'>
  env?: NodeJS.ProcessEnv
} = {}): CreativeCanvasProviderRuntimeReadiness {
  const env = input.env ?? process.env
  const config = runtimeConfigFromEnv(env)
  const baseUrl = cleanString(env.HIGGSFIELD_RUNTIME_URL)
  const explicitSubmitUrl = cleanString(env.HIGGSFIELD_RUNTIME_SUBMIT_URL)
  const appUrl = cleanString(env.NEXT_PUBLIC_APP_URL) ?? cleanString(env.NEXT_PUBLIC_BASE_URL)
  const hasRuntimeKey = Boolean(cleanString(env.HIGGSFIELD_RUNTIME_API_KEY))
  const internalBridgeConfigured = Boolean(!explicitSubmitUrl && !baseUrl && appUrl && hasRuntimeKey)
  const submitConfigured = Boolean(config.submitUrl)
  const statusPollingConfigured = Boolean(config.statusUrlTemplate || internalBridgeConfigured)
  const callbackBaseConfigured = Boolean(config.callbackBaseUrl)
  const webhookSecretConfigured = Boolean(config.webhookSecret)
  const linkedProjectId = cleanString(input.canvas?.linked?.projectId)
  const blockers: string[] = []
  const warnings: string[] = []

  if (!submitConfigured) blockers.push('Higgsfield runtime submit URL or internal bridge is not configured')
  if (!statusPollingConfigured) blockers.push('Higgsfield runtime status polling is not configured')
  if (!linkedProjectId) blockers.push('Canvas is not linked to a project for agent task execution')
  if (!callbackBaseConfigured) warnings.push('Callback base URL is not configured')
  if (!webhookSecretConfigured) warnings.push('Provider webhook secret is not configured')

  return {
    providerKey: 'higgsfield',
    runtimeConfigured: submitConfigured || statusPollingConfigured,
    submitConfigured,
    statusPollingConfigured,
    internalBridgeConfigured,
    callbackBaseConfigured,
    webhookSecretConfigured,
    linkedProjectId,
    blockers,
    warnings,
  }
}

function runtimeHeaders(config: HiggsfieldRuntimeConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  return headers
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { providerStatusMessage: text }
  }
}

function normalizeRuntimeStatus(value: unknown): CreativeCanvasRunStatus | undefined {
  const status = cleanString(value)?.toLowerCase()
  if (!status) return undefined
  if (['queued', 'pending'].includes(status)) return 'queued'
  if (['running', 'processing', 'submitted', 'in_progress'].includes(status)) return 'running'
  if (['waiting_for_review', 'needs_review', 'review'].includes(status)) return 'waiting_for_review'
  if (['completed', 'complete', 'succeeded', 'success', 'done'].includes(status)) return 'completed'
  if (['failed', 'error'].includes(status)) return 'failed'
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled'
  return undefined
}

function normalizeRuntimeResult(input: unknown): RuntimeResult {
  const envelope = asRecord(input)
  const body = envelope.success === true && envelope.data
    ? asRecord(envelope.data)
    : envelope
  const output = asRecord(body.output)
  const result = asRecord(body.result)
  const error = asRecord(body.error)
  const providerJobId = cleanString(body.providerJobId) ?? cleanString(body.jobId) ?? cleanString(result.id)
  const status = normalizeRuntimeStatus(body.status ?? body.state ?? result.status)
  const providerStatusMessage = cleanString(body.providerStatusMessage)
    ?? cleanString(body.message)
    ?? cleanString(result.message)
    ?? cleanString(error.message)
  return {
    providerJobId,
    providerRequestId: cleanString(body.providerRequestId) ?? cleanString(body.requestId),
    providerStatusUrl: cleanString(body.providerStatusUrl) ?? cleanString(body.statusUrl),
    providerCallbackUrl: cleanString(body.providerCallbackUrl) ?? cleanString(body.callbackUrl),
    status,
    providerStatus: cleanString(body.providerStatus) ?? cleanString(body.state) ?? cleanString(result.status),
    providerStatusMessage,
    error: status === 'failed'
      ? {
          code: cleanString(error.code) ?? 'higgsfield_runtime_error',
          message: cleanString(error.message) ?? providerStatusMessage ?? 'Higgsfield runtime failed',
          retryable: error.retryable !== false,
        }
      : undefined,
    output: {
      kind: cleanOutputKind(output.kind ?? result.kind),
      url: cleanString(output.url) ?? cleanString(result.url) ?? cleanString(body.url) ?? cleanString(body.imageUrl) ?? cleanString(body.videoUrl),
      thumbnailUrl: cleanString(output.thumbnailUrl) ?? cleanString(result.thumbnailUrl),
      artifactId: cleanString(output.artifactId) ?? cleanString(result.artifactId),
      storagePath: cleanString(output.storagePath) ?? cleanString(result.storagePath),
      textPreview: cleanString(output.textPreview) ?? cleanString(result.textPreview),
    },
    raw: input,
  }
}

async function listRunsByStatus(status: CreativeCanvasRunStatus, limit: number): Promise<RunWithId[]> {
  const snap = await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION)
    .where('providerKey', '==', 'higgsfield')
    .where('status', '==', status)
    .limit(limit)
    .get()
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as CreativeCanvasRun) }))
}

async function markRunSubmissionStarted(run: RunWithId): Promise<void> {
  await adminDb.collection(CREATIVE_CANVAS_RUN_COLLECTION).doc(run.id).update({
    status: 'running',
    providerStatus: 'runtime_submission_started',
    providerStatusMessage: 'Submitting Higgsfield run through the configured runtime bridge.',
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: HIGGSFIELD_ACTOR.uid,
    updatedByType: HIGGSFIELD_ACTOR.type,
  })
}

/**
 * Routes through refreshCreativeCanvasProviderRunStatus, which also refunds
 * the run's recorded credit charge on terminal failure (idempotently). Do not
 * add a separate refund here — that would rely on idempotency instead of a
 * single choke point.
 */
async function markRunFailed(run: RunWithId, message: string, code = 'higgsfield_runtime_error', retryable = true): Promise<void> {
  await refreshCreativeCanvasProviderRunStatus(run.id, run.orgId, {
    status: 'failed',
    providerStatus: code,
    providerStatusMessage: message,
    error: { code, message, retryable },
  }, HIGGSFIELD_ACTOR)
}

function callbackUrl(config: HiggsfieldRuntimeConfig): string | undefined {
  return config.callbackBaseUrl ? `${config.callbackBaseUrl}/api/v1/creative-canvas/provider-callbacks/higgsfield` : undefined
}

function statusUrlForRun(run: RunWithId, config: HiggsfieldRuntimeConfig): string | undefined {
  const jobId = run.provenance.providerJobId
  const statusUrl = config.statusUrlTemplate && jobId
    ? config.statusUrlTemplate.replace('{providerJobId}', encodeURIComponent(jobId))
    : run.provenance.providerStatusUrl
  if (!statusUrl) return undefined
  if (statusUrl.startsWith('/')) return config.callbackBaseUrl ? `${config.callbackBaseUrl}${statusUrl}` : undefined
  return statusUrl
}

function absoluteRuntimeUrl(value: string | undefined, config: HiggsfieldRuntimeConfig): string | undefined {
  if (!value) return undefined
  if (value.startsWith('/')) return config.callbackBaseUrl ? `${config.callbackBaseUrl}${value}` : undefined
  return value
}

async function applyRuntimeResult(run: RunWithId, result: RuntimeResult): Promise<'dispatched' | 'refreshed' | 'completed' | 'failed'> {
  if (result.providerJobId) {
    await dispatchCreativeCanvasProviderRun(run.id, run.orgId, {
      providerJobId: result.providerJobId,
      providerRequestId: result.providerRequestId,
      providerStatusUrl: result.providerStatusUrl,
      providerCallbackUrl: result.providerCallbackUrl,
    }, HIGGSFIELD_ACTOR)
  }

  if (result.status === 'completed') {
    if (!result.output?.url && !result.output?.artifactId && !result.output?.storagePath && !result.output?.textPreview) {
      await markRunFailed(run, 'Higgsfield runtime reported completion without an output artifact.', 'higgsfield_missing_output', true)
      return 'failed'
    }
    await completeCreativeCanvasRun(run.id, run.orgId, {
      outputNodeId: `${run.nodeId}-output`,
      output: {
        kind: result.output.kind ?? run.input.outputKind ?? 'image',
        url: result.output.url,
        thumbnailUrl: result.output.thumbnailUrl,
        artifactId: result.output.artifactId,
        storagePath: result.output.storagePath,
        textPreview: result.output.textPreview,
        rawProviderJobId: result.providerJobId ?? run.provenance.providerJobId,
      },
      provenance: {
        providerJobId: result.providerJobId ?? run.provenance.providerJobId,
        costLabel: 'higgsfield_runtime',
      },
    }, HIGGSFIELD_ACTOR)
    return 'completed'
  }

  if (result.status === 'failed' || result.status === 'cancelled') {
    await refreshCreativeCanvasProviderRunStatus(run.id, run.orgId, {
      status: result.status,
      providerStatus: result.providerStatus ?? result.error?.code,
      providerStatusMessage: result.providerStatusMessage ?? result.error?.message,
      error: result.error,
    }, HIGGSFIELD_ACTOR)
    return 'failed'
  }

  if (result.status) {
    await refreshCreativeCanvasProviderRunStatus(run.id, run.orgId, {
      status: result.status,
      providerStatus: result.providerStatus,
      providerStatusMessage: result.providerStatusMessage,
    }, HIGGSFIELD_ACTOR)
    return 'refreshed'
  }

  return result.providerJobId ? 'dispatched' : 'refreshed'
}

async function submitQueuedRun(run: RunWithId, config: HiggsfieldRuntimeConfig): Promise<'submitted' | 'completed' | 'failed'> {
  if (!config.submitUrl) return 'failed'
  const canvas = await getCreativeCanvas(run.canvasId, run.orgId)
  if (!canvas) {
    await markRunFailed(run, 'Creative canvas was not found before Higgsfield submission.', 'canvas_not_found', false)
    return 'failed'
  }
  await markRunSubmissionStarted(run)
  const manifest = buildHiggsfieldExecutionManifest(run, canvas)
  const response = await fetch(config.submitUrl, {
    method: 'POST',
    headers: runtimeHeaders(config),
    body: JSON.stringify({
      providerKey: 'higgsfield',
      run,
      canvas: {
        id: canvas.id,
        orgId: canvas.orgId,
        title: canvas.title,
        purpose: canvas.purpose,
      },
      manifest,
      callback: {
        url: callbackUrl(config),
        secretHeader: config.webhookSecret ? 'x-creative-canvas-provider-secret' : undefined,
        secretConfigured: Boolean(config.webhookSecret),
      },
    }),
  })
  const body = await readJsonResponse(response)
  if (!response.ok) {
    await markRunFailed(run, cleanString(body.error) ?? cleanString(body.message) ?? `Higgsfield runtime submit failed with ${response.status}`, 'higgsfield_submit_failed', true)
    return 'failed'
  }
  const result = normalizeRuntimeResult(body)
  result.providerStatusUrl = absoluteRuntimeUrl(result.providerStatusUrl, config)
  result.providerCallbackUrl = absoluteRuntimeUrl(result.providerCallbackUrl, config)
  const applied = await applyRuntimeResult(run, result)
  return applied === 'completed' ? 'completed' : applied === 'failed' ? 'failed' : 'submitted'
}

/**
 * Immediately submit a just-created queued run to the Higgsfield runtime
 * (internal Hermes bridge / external runtime) instead of waiting for the
 * 5-minute drain cron. Safe no-op when the runtime isn't configured.
 */
export async function dispatchCreativeCanvasRunNow(
  run: RunWithId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<'submitted' | 'completed' | 'failed' | 'not_configured'> {
  // Only Higgsfield runs go to the executor — other providers (agent_task,
  // manual_upload, …) have their own paths and the executor rejects them.
  if (run.providerKey !== 'higgsfield') return 'not_configured'
  const config = runtimeConfigFromEnv(env)
  if (!config.submitUrl) return 'not_configured'
  if (run.status !== 'queued') return 'not_configured'
  return submitQueuedRun(run, config)
}

async function pollRunningRun(run: RunWithId, config: HiggsfieldRuntimeConfig): Promise<'refreshed' | 'completed' | 'failed' | 'skipped'> {
  if (run.output?.url || run.output?.artifactId || run.output?.textPreview) {
    await ensureCreativeCanvasRunOutputNode(run.id, run.orgId, HIGGSFIELD_ACTOR)
    return 'completed'
  }
  const statusUrl = statusUrlForRun(run, config)
  if (!statusUrl) return 'skipped'
  const response = await fetch(statusUrl, { headers: runtimeHeaders(config) })
  const body = await readJsonResponse(response)
  if (!response.ok) {
    await refreshCreativeCanvasProviderRunStatus(run.id, run.orgId, {
      status: 'running',
      providerStatus: 'status_poll_failed',
      providerStatusMessage: cleanString(body.error) ?? cleanString(body.message) ?? `Higgsfield status poll failed with ${response.status}`,
    }, HIGGSFIELD_ACTOR)
    return 'failed'
  }
  const applied = await applyRuntimeResult(run, normalizeRuntimeResult(body))
  return applied === 'completed' ? 'completed' : applied === 'failed' ? 'failed' : 'refreshed'
}

export async function drainHiggsfieldCreativeCanvasRuns(options: {
  submitLimit?: number
  pollLimit?: number
  env?: NodeJS.ProcessEnv
} = {}): Promise<{ submitted: number; polled: number; completed: number; failed: number; skipped: number; runtimeConfigured: boolean }> {
  const config = runtimeConfigFromEnv(options.env)
  const runtimeConfigured = Boolean(config.submitUrl || config.statusUrlTemplate)
  if (!runtimeConfigured) {
    return { submitted: 0, polled: 0, completed: 0, failed: 0, skipped: 0, runtimeConfigured: false }
  }

  let submitted = 0
  let polled = 0
  let completed = 0
  let failed = 0
  let skipped = 0

  if (config.submitUrl) {
    const queuedRuns = await listRunsByStatus('queued', options.submitLimit ?? DEFAULT_BATCH_SIZE)
    for (const run of queuedRuns) {
      const result = await submitQueuedRun(run, config)
      if (result === 'submitted') submitted++
      if (result === 'completed') completed++
      if (result === 'failed') failed++
    }
  }

  const pollLimit = options.pollLimit ?? DEFAULT_BATCH_SIZE
  const runningRuns = [
    ...await listRunsByStatus('running', pollLimit),
    ...await listRunsByStatus('waiting_for_review', pollLimit),
    ...await listRunsByStatus('completed', pollLimit),
  ].slice(0, pollLimit)
  for (const run of runningRuns) {
    const result = await pollRunningRun(run, config)
    if (result === 'refreshed') polled++
    if (result === 'completed') completed++
    if (result === 'failed') failed++
    if (result === 'skipped') skipped++
  }

  return { submitted, polled, completed, failed, skipped, runtimeConfigured: true }
}
