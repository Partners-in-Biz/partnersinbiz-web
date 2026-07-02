#!/usr/bin/env node
/**
 * Higgsfield executor — deterministic Creative Canvas run runner.
 *
 * Replaces the LLM-agent dispatch path for `providerKey: higgsfield` runs.
 * Speaks the same submit contract as the platform's provider runtime
 * (`lib/creative-canvas/provider-runtime.ts` submitQueuedRun):
 *
 *   POST /creative-canvas/runs        { providerKey, run, canvas, manifest, callback }
 *   GET  /creative-canvas/runs/:jobId → { providerJobId, status, providerStatus, output? }
 *   GET  /health
 *
 * On accept it returns { providerJobId, status: "running" } immediately, then:
 *   1. downloads any http(s) reference media to temp files (the CLI only
 *      accepts local paths or upload UUIDs),
 *   2. runs `higgsfield generate create <model> --prompt ... --json --wait`,
 *   3. success → PUT provider-dispatch + PUT runs/{id}/complete (output node
 *      lands on the canvas),
 *   4. failure → PUT provider-status { status: "failed", error } so runs can
 *      NEVER sit on "running" silently.
 *
 * Env (see /etc/higgsfield-executor.env on the VPS):
 *   PORT                    listen port (default 8690, loopback only — Caddy fronts it)
 *   RUNTIME_API_KEY         bearer key the platform sends (HIGGSFIELD_RUNTIME_API_KEY)
 *   PIB_AGENT_API_KEY       platform API key used for the dispatch/status/complete PUTs
 *   PIB_APP_URL             fallback platform base URL (default https://partnersinbiz.online)
 *   HIGGSFIELD_BIN          CLI path (default: higgsfield on PATH)
 *   WAIT_TIMEOUT            CLI --wait-timeout (default 20m)
 */

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.PORT || 8690)
const RUNTIME_API_KEY = process.env.RUNTIME_API_KEY || ''
const PIB_AGENT_API_KEY = process.env.PIB_AGENT_API_KEY || ''
const PIB_APP_URL = (process.env.PIB_APP_URL || 'https://partnersinbiz.online').replace(/\/$/, '')
const HIGGSFIELD_BIN = process.env.HIGGSFIELD_BIN || 'higgsfield'
const WAIT_TIMEOUT = process.env.WAIT_TIMEOUT || '20m'

if (!RUNTIME_API_KEY) { console.error('RUNTIME_API_KEY is required'); process.exit(1) }
if (!PIB_AGENT_API_KEY) { console.error('PIB_AGENT_API_KEY is required'); process.exit(1) }

/** In-memory job registry: providerJobId -> state (also answers status polls). */
const jobs = new Map()
const JOB_TTL_MS = 24 * 60 * 60 * 1000

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }))
}

function constantTimeEqual(candidate, expected) {
  if (!expected) return false
  const a = createHash('sha256').update(candidate).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

function authorized(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') && constantTimeEqual(header.slice(7), RUNTIME_API_KEY)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 2_000_000) { reject(new Error('body too large')); req.destroy() }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

function baseUrlFrom(input) {
  const callbackUrl = input?.callback?.url
  if (typeof callbackUrl === 'string' && /^https?:\/\//.test(callbackUrl)) {
    try { return new URL(callbackUrl).origin } catch { /* fall through */ }
  }
  return PIB_APP_URL
}

async function platformPut(base, path, body) {
  const url = `${base}${path}`
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PIB_AGENT_API_KEY}` },
    body: JSON.stringify(body),
  })
  const text = await response.text().catch(() => '')
  if (!response.ok) log('warn', 'platform PUT failed', { url, status: response.status, body: text.slice(0, 300) })
  return response.ok
}

function runCli(args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(HIGGSFIELD_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs)
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: String(error) })
    })
  })
}

/** The CLI prints one or more JSON documents; take the last parseable object. */
function lastJsonObject(text) {
  const objects = []
  let index = 0
  while (index < text.length) {
    if (text[index] === '{') {
      try {
        // Naive brace matching is unsafe inside strings; rely on JSON.parse of slices.
        for (let end = text.length; end > index; end -= 1) {
          const candidate = text.slice(index, end)
          if (!candidate.trimEnd().endsWith('}')) continue
          try { objects.push(JSON.parse(candidate)); index = end - 1; break } catch { /* keep shrinking */ }
        }
      } catch { /* ignore */ }
    }
    index += 1
  }
  return objects.length ? objects[objects.length - 1] : null
}

function extractOutputUrl(result) {
  if (!result || typeof result !== 'object') return undefined
  if (typeof result.result_url === 'string') return result.result_url
  const results = Array.isArray(result.results) ? result.results : []
  for (const item of results) {
    if (typeof item === 'string') return item
    if (item && typeof item.url === 'string') return item.url
    if (item && typeof item.result_url === 'string') return item.result_url
  }
  if (result.job && typeof result.job === 'object') return extractOutputUrl(result.job)
  return undefined
}

const CONTENT_TYPE_EXTENSIONS = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
}

function sniffExtension(buffer) {
  if (buffer.length < 12) return undefined
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg'
  if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') return 'webp'
  if (buffer.slice(0, 3).toString() === 'GIF') return 'gif'
  if (buffer.slice(4, 8).toString() === 'ftyp') return 'mp4'
  return undefined
}

async function downloadMedia(url, dir, index) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`reference download failed (${response.status}): ${url.slice(0, 120)}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > 50_000_000) throw new Error('reference media larger than 50MB')
  // Many CDN URLs (Unsplash, storage buckets) have no path extension — the CLI
  // detects media type from the file name, so resolve it from Content-Type,
  // the URL path, or the magic bytes, in that order.
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const extension = CONTENT_TYPE_EXTENSIONS[contentType]
    ?? (new URL(url).pathname.match(/\.(png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav)$/i) || [])[1]?.toLowerCase()
    ?? sniffExtension(buffer)
  if (!extension) throw new Error(`could not determine media type for reference: ${url.slice(0, 120)}`)
  const file = join(dir, `ref-${index}.${extension === 'jpeg' ? 'jpg' : extension}`)
  await writeFile(file, buffer)
  return file
}

async function executeRun(job, input) {
  const run = input.run
  const manifest = input.manifest || {}
  const base = baseUrlFrom(input)
  const orgQuery = `?orgId=${encodeURIComponent(run.orgId)}`
  const dispatchPath = manifest.dispatch?.path || `/api/v1/creative-canvas/${run.canvasId}/runs/${run.id}/provider-dispatch${orgQuery}`
  const statusPath = manifest.statusRefresh?.path || `/api/v1/creative-canvas/${run.canvasId}/runs/${run.id}/provider-status${orgQuery}`
  const completePath = `/api/v1/creative-canvas/${run.canvasId}/runs/${run.id}/complete${orgQuery}`

  const fail = async (message, code = 'higgsfield_cli_error') => {
    job.status = 'failed'
    job.providerStatus = code
    job.providerStatusMessage = message.slice(0, 500)
    log('error', 'run failed', { runId: run.id, code, message: job.providerStatusMessage })
    await platformPut(base, statusPath, {
      status: 'failed',
      providerStatus: code,
      providerStatusMessage: job.providerStatusMessage,
      error: { code, message: job.providerStatusMessage, retryable: true },
    })
  }

  let workDir
  try {
    await platformPut(base, dispatchPath, {
      providerJobId: job.providerJobId,
      providerStatusUrl: `/higgsfield-executor/creative-canvas/runs/${job.providerJobId}`,
    })

    const model = run.model || 'nano_banana_flash'
    const prompt = run.input?.promptSummary || 'Generate a reviewable internal creative asset.'
    workDir = await mkdtemp(join(tmpdir(), 'hfx-'))

    const mediaArgs = []
    const sourceMedia = Array.isArray(manifest.sourceMedia) ? manifest.sourceMedia : []
    for (let index = 0; index < sourceMedia.length; index += 1) {
      const media = sourceMedia[index]
      if (!media?.value || !media?.flag) continue
      const value = /^https?:\/\//.test(media.value)
        ? await downloadMedia(media.value, workDir, index)
        : media.value
      mediaArgs.push(media.flag, value)
    }

    const buildArgs = (extras) => [
      'generate', 'create', model,
      '--prompt', prompt,
      ...mediaArgs,
      ...extras,
      '--json', '--wait', '--wait-timeout', WAIT_TIMEOUT,
    ]

    const extras = []
    if (run.input?.aspectRatio) extras.push('--aspect_ratio', run.input.aspectRatio)
    if (run.input?.durationSeconds) extras.push('--duration', String(run.input.durationSeconds))

    const timeoutMs = 25 * 60 * 1000
    let result = await runCli(buildArgs(extras), timeoutMs)
    if (result.code !== 0 && extras.length && /param|unknown flag|invalid|not allowed|unexpected/i.test(result.stderr + result.stdout)) {
      log('warn', 'retrying without optional params', { runId: run.id })
      result = await runCli(buildArgs([]), timeoutMs)
    }

    if (result.code !== 0) {
      await fail(`Higgsfield CLI exited ${result.code}: ${(result.stderr || result.stdout).trim().slice(0, 400)}`)
      return
    }

    const parsed = lastJsonObject(result.stdout)
    const outputUrl = extractOutputUrl(parsed)
    const providerJob = parsed && typeof parsed.id === 'string' ? parsed.id : undefined
    if (!outputUrl) {
      await fail(`Higgsfield CLI succeeded but no result URL was found in output: ${result.stdout.trim().slice(0, 300)}`, 'higgsfield_missing_output')
      return
    }

    const outputKind = run.input?.outputKind === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(outputUrl) ? 'video' : (run.input?.outputKind || 'image')
    const completed = await platformPut(base, completePath, {
      outputNodeId: `${run.nodeId}-output`,
      output: { kind: outputKind, url: outputUrl, rawProviderJobId: providerJob },
      provenance: { providerJobId: providerJob || job.providerJobId, costLabel: 'higgsfield_executor' },
    })
    if (!completed) {
      await fail('Generation succeeded but the platform rejected run completion — see executor logs.', 'platform_complete_failed')
      return
    }

    job.status = 'completed'
    job.providerStatus = 'completed'
    job.providerStatusMessage = 'Completed by higgsfield-executor.'
    job.output = { kind: outputKind, url: outputUrl }
    log('info', 'run completed', { runId: run.id, providerJob, outputKind })
  } catch (error) {
    await fail(`Executor error: ${String(error?.message || error).slice(0, 400)}`, 'executor_error')
  } finally {
    if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {})
    setTimeout(() => jobs.delete(job.providerJobId), JOB_TTL_MS).unref?.()
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, jobs: jobs.size })
    }
    if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' })

    if (req.method === 'POST' && url.pathname === '/creative-canvas/runs') {
      const body = JSON.parse(await readBody(req) || 'null')
      const run = body?.run
      if (body?.providerKey !== 'higgsfield' || !run?.id || !run?.orgId || !run?.canvasId || !run?.nodeId) {
        return json(res, 400, { error: 'Valid higgsfield run payload is required' })
      }
      const providerJobId = `hfx-${run.id}-${randomUUID().slice(0, 8)}`
      const job = { providerJobId, runId: run.id, status: 'running', providerStatus: 'executor_accepted', providerStatusMessage: 'Higgsfield executor accepted the run.', createdAt: Date.now() }
      jobs.set(providerJobId, job)
      log('info', 'run accepted', { runId: run.id, providerJobId, model: run.model })
      executeRun(job, body).catch((error) => log('error', 'executeRun crashed', { runId: run.id, error: String(error) }))
      return json(res, 200, {
        providerJobId,
        status: 'running',
        providerStatus: job.providerStatus,
        providerStatusMessage: job.providerStatusMessage,
        providerStatusUrl: `/higgsfield-executor/creative-canvas/runs/${providerJobId}`,
      })
    }

    const statusMatch = url.pathname.match(/^\/creative-canvas\/runs\/([A-Za-z0-9-]+)$/)
    if (req.method === 'GET' && statusMatch) {
      const job = jobs.get(statusMatch[1])
      if (!job) return json(res, 404, { error: 'Job not found' })
      return json(res, 200, {
        providerJobId: job.providerJobId,
        status: job.status,
        providerStatus: job.providerStatus,
        providerStatusMessage: job.providerStatusMessage,
        ...(job.output ? { output: job.output } : {}),
      })
    }

    return json(res, 404, { error: 'Not found' })
  } catch (error) {
    log('error', 'request error', { error: String(error) })
    return json(res, 500, { error: 'Internal executor error' })
  }
})

server.listen(PORT, '127.0.0.1', () => log('info', `higgsfield-executor listening on 127.0.0.1:${PORT}`))
