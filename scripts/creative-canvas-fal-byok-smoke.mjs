#!/usr/bin/env node

/**
 * Gated fal.ai BYOK smoke for Creative Canvas.
 *
 * This script is intentionally safe by default: it will not write credentials,
 * revoke connections, or submit paid generation unless an explicit approval
 * token is present in the environment. It never prints raw credential values.
 */

const DEFAULT_BASE = 'http://localhost:3010/api/v1'
const APPROVAL_TOKEN = 'YES_I_APPROVE_PAID_FAL_SMOKE'
const ORG_ID = process.env.PIB_FAL_BYOK_SMOKE_ORG_ID || process.env.PIB_ORG_ID || 'pib-platform-owner'
const API_BASE = (process.env.PIB_API_BASE || DEFAULT_BASE).replace(/\/$/, '')
const API_KEY = process.env.PIB_AGENT_API_KEY || process.env.AI_API_KEY
const FAL_API_KEY = process.env.PIB_FAL_BYOK_SMOKE_KEY || process.env.FAL_API_KEY
const APPROVAL = process.env.PIB_FAL_BYOK_SMOKE_APPROVED
const RUN_PAID = APPROVAL === APPROVAL_TOKEN
const SKIP_REVOKE = process.env.PIB_FAL_BYOK_SMOKE_SKIP_REVOKE === '1'
const CONNECTION_ID = `org:${ORG_ID}:fal`
const ENCODED_CONNECTION_ID = encodeURIComponent(CONNECTION_ID)
const MINIMAL_MODEL = process.env.PIB_FAL_BYOK_SMOKE_MODEL || 'fal-flux-2-pro'
const PROMPT = process.env.PIB_FAL_BYOK_SMOKE_PROMPT || 'Minimal product-style smoke test image: a small blue square on a plain white background.'
const TIMEOUT_MS = Number(process.env.PIB_FAL_BYOK_SMOKE_TIMEOUT_MS || 180000)
const POLL_MS = Number(process.env.PIB_FAL_BYOK_SMOKE_POLL_MS || 5000)

const FAL_SLUGS = [
  'fal-ai/flux-2-pro',
  'fal-ai/kling-video/v2.6/pro/text-to-video',
  'fal-ai/veo3.1',
]

function redacted(value) {
  if (!value) return '(missing)'
  const visible = String(value).slice(-4)
  return `redacted…${visible}`
}

function logStep(message, detail) {
  if (detail === undefined) console.log(`- ${message}`)
  else console.log(`- ${message}: ${detail}`)
}

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exitCode = 1
}

async function request(path, options = {}) {
  if (!API_KEY) throw new Error('Missing PIB_AGENT_API_KEY or AI_API_KEY')
  const url = `${API_BASE}${path}`
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    'X-Org-Id': ORG_ID,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  }
  const res = await fetch(url, { ...options, headers })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text.slice(0, 500) } }
  if (!res.ok) {
    const error = body?.error || body?.message || body?.raw || `${res.status} ${res.statusText}`
    throw new Error(`${options.method || 'GET'} ${path} failed: ${error}`)
  }
  return body?.data ?? body
}

function connectionSummary(connection) {
  if (!connection) return '(not found)'
  return JSON.stringify({
    id: connection.id,
    provider: connection.provider,
    scope: connection.scope,
    status: connection.status,
    hasCredentials: connection.hasCredentials,
    credentialHint: connection.credentialHint,
    lastValidatedAt: connection.lastValidatedAt || null,
    lastError: connection.lastError || null,
  })
}

async function listFalConnection() {
  const data = await request(`/creative-canvas/connections?orgId=${encodeURIComponent(ORG_ID)}`)
  return (data.connections || []).find((conn) => conn.provider === 'fal' && conn.id === CONNECTION_ID) || null
}

async function probeFalSlugs() {
  const results = []
  for (const slug of FAL_SLUGS) {
    const res = await fetch(`https://queue.fal.run/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    let body = null
    try { body = await res.json() } catch {}
    results.push({ slug, status: res.status, authRequired: res.status === 401 || res.status === 403, notFound: res.status === 404, message: body?.detail || body?.message || body?.error || null })
  }
  return results
}

async function createOrReplaceFalConnection() {
  const data = await request(`/creative-canvas/connections?orgId=${encodeURIComponent(ORG_ID)}`, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'fal',
      scope: 'org',
      label: 'fal.ai BYOK smoke connection',
      credentials: { apiKey: FAL_API_KEY },
      meta: { purpose: 'creative-canvas-fal-byok-smoke' },
    }),
  })
  return data.connection
}

async function revokeFalConnection() {
  const data = await request(`/creative-canvas/connections/${ENCODED_CONNECTION_ID}?orgId=${encodeURIComponent(ORG_ID)}`, { method: 'DELETE' })
  return data.connection
}

async function createCanvas() {
  const data = await request(`/creative-canvas?orgId=${encodeURIComponent(ORG_ID)}`, {
    method: 'POST',
    body: JSON.stringify({
      title: `fal BYOK smoke ${new Date().toISOString()}`,
      purpose: 'Provider validation smoke; safe to delete after review.',
      nodes: [{
        id: 'prompt-1',
        type: 'prompt',
        title: 'fal smoke prompt',
        position: { x: 0, y: 0 },
        data: { prompt: PROMPT },
      }],
    }),
  })
  return data.canvas
}

async function submitGeneration(canvasId) {
  const data = await request(`/creative-canvas/${encodeURIComponent(canvasId)}/runs/generate?orgId=${encodeURIComponent(ORG_ID)}`, {
    method: 'POST',
    body: JSON.stringify({
      nodeId: 'prompt-1',
      model: MINIMAL_MODEL,
      prompt: PROMPT,
      aspectRatio: '1:1',
      batch: 1,
    }),
  })
  return data.run
}

async function readRuns(canvasId) {
  const data = await request(`/creative-canvas/${encodeURIComponent(canvasId)}/runs?orgId=${encodeURIComponent(ORG_ID)}`)
  return data.runs || []
}

async function waitForRun(canvasId, runId) {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    const runs = await readRuns(canvasId)
    const run = runs.find((candidate) => candidate.id === runId)
    if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) return run
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error(`Timed out waiting for run ${runId}`)
}

async function main() {
  console.log('Creative Canvas fal.ai BYOK smoke')
  logStep('orgId', ORG_ID)
  logStep('apiBase', API_BASE)
  logStep('api key', redacted(API_KEY))
  logStep('fal key', redacted(FAL_API_KEY))
  logStep('paid/write gate', RUN_PAID ? 'approved' : `blocked; set PIB_FAL_BYOK_SMOKE_APPROVED=${APPROVAL_TOKEN}`)

  const slugResults = await probeFalSlugs()
  logStep('fal slug probes', JSON.stringify(slugResults))

  if (!API_KEY) return fail('Cannot inspect Creative Canvas connections without PIB_AGENT_API_KEY or AI_API_KEY.')

  let before = null
  try {
    before = await listFalConnection()
    logStep('current fal connection', connectionSummary(before))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logStep('current fal connection', `unavailable (${message})`)
    if (RUN_PAID) throw err
  }

  if (!RUN_PAID) {
    console.log('\nGate is closed. No credentials were written, no connection was revoked, and no generation was submitted.')
    console.log('Checklist after Peet approval: set PIB_FAL_BYOK_SMOKE_KEY, set approval token, run this script locally/staging, capture masked connection/readback/revoke/generation evidence, then remove or revoke test credentials if required.')
    return
  }

  if (!FAL_API_KEY) return fail('Approval token is set but no fal key was provided in PIB_FAL_BYOK_SMOKE_KEY or FAL_API_KEY.')

  const connected = await createOrReplaceFalConnection()
  logStep('connected fal connection', connectionSummary(connected))
  if (connected.hasCredentials !== true || connected.status !== 'connected') return fail('fal connection did not read back as connected with masked credentials.')
  if (JSON.stringify(connected).includes(FAL_API_KEY)) return fail('Raw fal key leaked in connection response.')

  if (!SKIP_REVOKE) {
    const revoked = await revokeFalConnection()
    logStep('revoked fal connection', connectionSummary(revoked))
    if (JSON.stringify(revoked).includes(FAL_API_KEY)) return fail('Raw fal key leaked in revoke response.')
    const reconnected = await createOrReplaceFalConnection()
    logStep('reconnected fal connection for generation', connectionSummary(reconnected))
  } else {
    logStep('revoke check', 'skipped by PIB_FAL_BYOK_SMOKE_SKIP_REVOKE=1')
  }

  const canvas = await createCanvas()
  logStep('created canvas', canvas.id)
  const queuedRun = await submitGeneration(canvas.id)
  logStep('submitted fal image run', JSON.stringify({ id: queuedRun.id, status: queuedRun.status, providerKey: queuedRun.providerKey, model: queuedRun.model, provenance: queuedRun.provenance }))
  const finalRun = await waitForRun(canvas.id, queuedRun.id)
  logStep('final fal image run', JSON.stringify({ id: finalRun.id, status: finalRun.status, output: finalRun.output, provenance: finalRun.provenance, error: finalRun.error || null }))

  if (finalRun.status !== 'completed' || !finalRun.output?.url) return fail('fal image generation did not complete with an artifact URL.')
  if (finalRun.provenance?.costUnits !== 0 || finalRun.provenance?.costLabel !== 'byok:fal') return fail('fal BYOK provenance did not carry costUnits=0 and costLabel=byok:fal.')

  console.log('\nPASS: fal.ai BYOK connection, masked readback, revoke/reconnect, slug eligibility, and minimal image generation were verified.')
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
