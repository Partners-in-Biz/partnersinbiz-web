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
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileEditorFiltergraph } from './lib/editor-filtergraph.mjs'
import { assertAllowedMediaUrl, computePeaksFromPcm } from './lib/editor-media.mjs'
import { buildAssDocument, timelineHasCaptions } from './lib/editor-captions.mjs'
import { audioExtractArgs, segmentsFromVerboseJson } from './lib/editor-transcribe.mjs'
import { buildVidstabDetectArgs, buildVidstabTransformArgs, collectStabilizeClips, stableClipToken } from './lib/editor-stabilize.mjs'

const PORT = Number(process.env.PORT || 8690)
const RUNTIME_API_KEY = process.env.RUNTIME_API_KEY || ''
const PIB_AGENT_API_KEY = process.env.PIB_AGENT_API_KEY || ''
const PIB_APP_URL = (process.env.PIB_APP_URL || 'https://partnersinbiz.online').replace(/\/$/, '')
const HIGGSFIELD_BIN = process.env.HIGGSFIELD_BIN || 'higgsfield'
const WAIT_TIMEOUT = process.env.WAIT_TIMEOUT || '20m'
// Retry budget for the provider's async input-media IP check (image-to-video /
// combine). Defaults ≈ 10 × 30s = 5 min of patient polling before giving up.
const IP_CHECK_MAX_RETRIES = Number(process.env.IP_CHECK_MAX_RETRIES || 10)
const IP_CHECK_RETRY_MS = Number(process.env.IP_CHECK_RETRY_MS || 30000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  return { ok: response.ok, status: response.status, body: text }
}

function runCli(args, timeoutMs, envOverrides) {
  return new Promise((resolve) => {
    const spawnEnv = envOverrides ? { ...process.env, ...envOverrides } : undefined
    const child = spawn(HIGGSFIELD_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'], ...(spawnEnv ? { env: spawnEnv } : {}) })
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

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg'
const EDITOR_RENDER_TIMEOUT_MS = Number(process.env.EDITOR_RENDER_TIMEOUT_MS || 30 * 60 * 1000)
const EDITOR_MEDIA_MAX_BYTES = Number(process.env.EDITOR_MEDIA_MAX_BYTES || 2_000_000_000)
const EDITOR_EXTRA_MEDIA_HOSTS = (process.env.EDITOR_EXTRA_MEDIA_HOSTS || '')
  .split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)
const EDITOR_FONT_FILE = process.env.EDITOR_FONT_FILE || undefined
const TRANSCRIBE_BASE_URL = (process.env.TRANSCRIBE_BASE_URL || 'https://ai-gateway.vercel.sh/v1').replace(/\/$/, '')
const TRANSCRIBE_API_KEY = process.env.TRANSCRIBE_API_KEY || ''
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || 'openai/whisper-1'
const TRANSCRIBE_BYOK_DEFAULT_MODEL = 'whisper-1'
const EDITOR_TRANSCRIBE_TIMEOUT_MS = Number(process.env.EDITOR_TRANSCRIBE_TIMEOUT_MS || 15 * 60 * 1000)
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe'
const PREVIEW_TIMEOUT_MS = Number(process.env.PREVIEW_TIMEOUT_MS || 15 * 60 * 1000)
const PROXY_MIN_BYTES = Number(process.env.PROXY_MIN_BYTES || 25_000_000)
const WAVEFORM_PEAKS_PER_SECOND = 20
const EDITOR_EFFECT_ASSET_MAX_BYTES = Number(process.env.EDITOR_EFFECT_ASSET_MAX_BYTES || 2_000_000)

/** Run ffmpeg, capturing stderr. Never rejects — resolves with the exit code. */
function runFfmpeg(args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs)
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stderr }) })
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: -1, stderr: String(error) }) })
  })
}

/** Run ffmpeg capturing stdout as a Buffer (for PCM decode). */
function runFfmpegStdout(args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    let stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs)
    child.stdout.on('data', (d) => { chunks.push(d) })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(chunks), stderr }) })
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: -1, stdout: Buffer.alloc(0), stderr: String(error) }) })
  })
}

/** ffprobe → { durationSeconds, width, height } (zeros when a field is missing). */
async function probeMedia(filePath) {
  const result = await new Promise((resolve) => {
    const child = spawn(FFPROBE_BIN, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-show_entries', 'format=duration',
      '-of', 'json', filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.on('close', () => resolve(stdout))
    child.on('error', () => resolve(''))
  })
  try {
    const parsed = JSON.parse(result)
    return {
      durationSeconds: Number(parsed?.format?.duration) || 0,
      width: Number(parsed?.streams?.[0]?.width) || 0,
      height: Number(parsed?.streams?.[0]?.height) || 0,
    }
  } catch {
    return { durationSeconds: 0, width: 0, height: 0 }
  }
}

async function platformGet(base, path) {
  const response = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${PIB_AGENT_API_KEY}` },
  })
  const text = await response.text().catch(() => '')
  let body = {}
  try { body = JSON.parse(text) } catch { /* keep empty */ }
  return { ok: response.ok, status: response.status, body: body?.data ?? body }
}

async function platformDelete(base, path) {
  const response = await fetch(`${base}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${PIB_AGENT_API_KEY}` },
  })
  if (!response.ok) log('warn', 'platform DELETE failed', { path, status: response.status })
  return response.ok
}

async function uploadPreviewArtifact(base, buffer, orgId, folder, filename, contentType) {
  const form = new FormData()
  form.set('file', new Blob([buffer], { type: contentType }), filename)
  form.set('folder', folder)
  form.set('filename', filename)
  form.set('orgId', orgId)
  const response = await fetch(`${base}/api/v1/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PIB_AGENT_API_KEY}` },
    body: form,
  })
  const text = await response.text().catch(() => '')
  if (!response.ok) throw new Error(`preview artifact upload failed (${response.status}): ${text.slice(0, 300)}`)
  let body = {}
  try { body = JSON.parse(text) } catch { /* keep empty */ }
  const data = body?.data ?? body
  if (!data?.url || !data?.storagePath) throw new Error('preview artifact upload returned no url/storagePath')
  return { url: data.url, storagePath: data.storagePath }
}

/**
 * Clip a local video to [start, end] seconds so the provider only processes the
 * segment the user selected — Higgsfield/Shorts Studio charges per second of
 * source footage it analyzes, so a 2-minute upload costs far more than a 4s
 * clip. Best-effort: on any failure (bad window, ffmpeg missing/errored) fall
 * back to the full file so a run never fails because of the optimization.
 * `-ss` before `-i` seeks fast; `-t <duration>` after `-i` is unambiguous and
 * we re-encode so the cut is frame-accurate at arbitrary points.
 */
async function clipVideoSegment(inputFile, startSeconds, endSeconds, dir, index) {
  const start = Number(startSeconds)
  const end = Number(endSeconds)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return inputFile
  const duration = Math.round((end - Math.max(0, start)) * 1000) / 1000
  if (!(duration > 0)) return inputFile
  const output = join(dir, `clip-${index}.mp4`)
  const result = await runFfmpeg([
    '-y', '-ss', String(Math.max(0, start)), '-i', inputFile, '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-movflags', '+faststart', output,
  ], 5 * 60 * 1000)
  if (result.code !== 0) {
    log('warn', 'video clip failed — dispatching full source', { index, code: result.code, stderr: result.stderr.slice(-200) })
    return inputFile
  }
  log('info', 'clipped video segment before dispatch', { index, start: Math.max(0, start), end, duration })
  return output
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
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/flac': 'flac',
}

function sniffExtension(buffer) {
  if (buffer.length < 12) return undefined
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg'
  if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') return 'webp'
  if (buffer.slice(0, 3).toString() === 'GIF') return 'gif'
  if (buffer.slice(4, 8).toString() === 'ftyp') return 'mp4'
  // Audio magic bytes: MP3 (ID3 tag or frame sync), WAV (RIFF....WAVE), FLAC, OGG.
  if (buffer.slice(0, 3).toString() === 'ID3') return 'mp3'
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3'
  if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WAVE') return 'wav'
  if (buffer.slice(0, 4).toString() === 'fLaC') return 'flac'
  if (buffer.slice(0, 4).toString() === 'OggS') return 'ogg'
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

async function downloadEditorMedia(url, dir, index) {
  let current = assertAllowedMediaUrl(url, { extraHosts: EDITOR_EXTRA_MEDIA_HOSTS }).href
  let response
  for (let hop = 0; hop < 5; hop += 1) {
    response = await fetch(current, { redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`redirect without location: ${current.slice(0, 120)}`)
      current = assertAllowedMediaUrl(new URL(location, current).href, { extraHosts: EDITOR_EXTRA_MEDIA_HOSTS }).href
      continue
    }
    break
  }
  if (!response || !response.ok) {
    throw new Error(`media download failed (${response ? response.status : 'no response'}): ${current.slice(0, 120)}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > EDITOR_MEDIA_MAX_BYTES) throw new Error(`media larger than ${EDITOR_MEDIA_MAX_BYTES} bytes: ${current.slice(0, 120)}`)
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  let extension = CONTENT_TYPE_EXTENSIONS[contentType]
    ?? (new URL(current).pathname.match(/\.(png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|cube)$/i) || [])[1]?.toLowerCase()
    ?? sniffExtension(buffer)
  if (!extension && /\.cube(\?|$)/i.test(current)) extension = 'cube'
  if (!extension) throw new Error(`could not determine media type: ${current.slice(0, 120)}`)
  const file = join(dir, `media-${index}.${extension === 'jpeg' ? 'jpg' : extension}`)
  await writeFile(file, buffer)
  return file
}

function isCubeLut(buffer) {
  const head = buffer.slice(0, 4096).toString('utf8')
  return /\bLUT_3D_SIZE\b/.test(head)
}

async function downloadEditorEffectAsset(url, dir, index) {
  let current = assertAllowedMediaUrl(url, { extraHosts: EDITOR_EXTRA_MEDIA_HOSTS }).href
  let response
  for (let hop = 0; hop < 5; hop += 1) {
    response = await fetch(current, { redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`redirect without location: ${current.slice(0, 120)}`)
      current = assertAllowedMediaUrl(new URL(location, current).href, { extraHosts: EDITOR_EXTRA_MEDIA_HOSTS }).href
      continue
    }
    break
  }
  if (!response || !response.ok) {
    throw new Error(`effect asset download failed (${response ? response.status : 'no response'}): ${current.slice(0, 120)}`)
  }
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > EDITOR_EFFECT_ASSET_MAX_BYTES) throw new Error(`effect asset larger than ${EDITOR_EFFECT_ASSET_MAX_BYTES} bytes`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > EDITOR_EFFECT_ASSET_MAX_BYTES) throw new Error(`effect asset larger than ${EDITOR_EFFECT_ASSET_MAX_BYTES} bytes`)
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const hasCubePath = /\.cube(\?|$)/i.test(current) || /\.cube$/i.test(new URL(current).pathname)
  if (contentType && !['text/plain', 'application/octet-stream', 'application/x-cube'].includes(contentType) && !hasCubePath) {
    throw new Error(`unsupported effect asset content type: ${contentType}`)
  }
  if (!isCubeLut(buffer)) throw new Error('effect asset is not a valid .cube LUT')
  const file = join(dir, `effect-${index}.cube`)
  await writeFile(file, buffer)
  return file
}

async function uploadRenderedMp4(base, filePath, orgId, folder, filename) {
  const buffer = await readFile(filePath)
  const form = new FormData()
  form.set('file', new Blob([buffer], { type: 'video/mp4' }), filename)
  form.set('folder', folder)
  form.set('filename', filename)
  form.set('orgId', orgId)
  const response = await fetch(`${base}/api/v1/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PIB_AGENT_API_KEY}` },
    body: form,
  })
  const text = await response.text().catch(() => '')
  if (!response.ok) throw new Error(`platform upload failed (${response.status}): ${text.slice(0, 300)}`)
  let body = {}
  try { body = JSON.parse(text) } catch { /* keep empty */ }
  const data = body?.data ?? body
  if (!data?.url || !data?.storagePath) throw new Error('platform upload returned no url/storagePath')
  return {
    url: data.url,
    storagePath: data.storagePath,
    uploadId: data.id,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    sizeBytes: buffer.length,
  }
}

async function executeEditorRender(job, manifest) {
  const base = baseUrlFrom(manifest)
  const reportPath = manifest.report?.path
    || `/api/v1/video-editor/render-jobs/${manifest.job.id}?orgId=${encodeURIComponent(manifest.job.orgId)}`

  const fail = async (message, code = 'editor_render_error') => {
    job.status = 'failed'
    job.providerStatus = code
    job.providerStatusMessage = message.slice(0, 1500)
    log('error', 'editor render failed', { jobId: manifest.job.id, code, message: job.providerStatusMessage })
    await platformPut(base, reportPath, { status: 'failed', error: { code, message: message.slice(0, 4000) } })
  }

  let workDir
  try {
    await platformPut(base, reportPath, { status: 'rendering' })
    workDir = await mkdtemp(join(tmpdir(), 'vedit-'))

    const localMediaPaths = {}
    const media = Array.isArray(manifest.media) ? manifest.media : []
    for (let index = 0; index < media.length; index += 1) {
      const entry = media[index]
      if (!entry?.clipId || !entry?.url) continue
      try {
        localMediaPaths[entry.clipId] = await downloadEditorMedia(entry.url, workDir, index)
      } catch (error) {
        await fail(
          `Media download failed for clip ${entry.clipId} (${String(entry.url).slice(0, 120)}): ${String(error?.message || error)}`,
          'editor_media_download_failed',
        )
        return
      }
    }

    const localEffectAssetPaths = {}
    const effectAssets = Array.isArray(manifest.effectAssets) ? manifest.effectAssets : []
    for (let index = 0; index < effectAssets.length; index += 1) {
      const entry = effectAssets[index]
      if (!entry?.clipId || typeof entry.effectIndex !== 'number' || !entry?.url) continue
      try {
        localEffectAssetPaths[`${entry.clipId}:${entry.effectIndex}`] = await downloadEditorEffectAsset(entry.url, workDir, index)
      } catch (error) {
        await fail(`Effect asset download failed for clip ${entry.clipId}: ${String(error?.message || error)}`, 'editor_effect_asset_download_failed')
        return
      }
    }

    for (const stab of collectStabilizeClips(manifest.timeline)) {
      const inputPath = localMediaPaths[stab.clipId]
      if (!inputPath) continue
      const token = stableClipToken(stab.clipId)
      const trfPath = join(workDir, `stab-${token}.trf`)
      const stabilizedPath = join(workDir, `stab-${token}.mp4`)
      const detect = await runFfmpeg(buildVidstabDetectArgs(inputPath, trfPath, stab.params), EDITOR_RENDER_TIMEOUT_MS)
      if (detect.code !== 0) {
        log('warn', 'vidstabdetect failed - rendering unstabilized', { clipId: stab.clipId, stderr: detect.stderr.slice(-200) })
        continue
      }
      const transform = await runFfmpeg(buildVidstabTransformArgs(inputPath, trfPath, stabilizedPath, stab.params), EDITOR_RENDER_TIMEOUT_MS)
      if (transform.code !== 0) {
        log('warn', 'vidstabtransform failed - rendering unstabilized', { clipId: stab.clipId, stderr: transform.stderr.slice(-200) })
        continue
      }
      localMediaPaths[stab.clipId] = stabilizedPath
      log('info', 'stabilized clip media', { clipId: stab.clipId })
    }

    let captionAssPath
    if (timelineHasCaptions(manifest.timeline)) {
      captionAssPath = join(workDir, 'captions.ass')
      await writeFile(captionAssPath, buildAssDocument({ timeline: manifest.timeline, settings: manifest.settings }), 'utf8')
    }

    const compiled = compileEditorFiltergraph({
      timeline: manifest.timeline,
      settings: manifest.settings,
      localMediaPaths,
      localEffectAssetPaths,
      ...(EDITOR_FONT_FILE ? { fontFile: EDITOR_FONT_FILE } : {}),
      ...(captionAssPath ? { captionAssPath } : {}),
    })

    const outPath = join(workDir, 'out.mp4')
    const result = await runFfmpeg(
      ['-y', ...compiled.inputs, '-filter_complex', compiled.filterComplex, ...compiled.outputArgs, outPath],
      EDITOR_RENDER_TIMEOUT_MS,
    )
    if (result.code !== 0) {
      await fail(`ffmpeg exited ${result.code}: ${result.stderr.trim().slice(-1500)}`, 'ffmpeg_failed')
      return
    }
    const stats = await stat(outPath)
    if (!(stats.size > 0)) {
      await fail('ffmpeg produced an empty output file', 'ffmpeg_empty_output')
      return
    }

    const uploaded = await uploadRenderedMp4(
      base,
      outPath,
      manifest.job.orgId,
      manifest.upload?.folder || `video-editor/${manifest.job.orgId}/${manifest.job.projectId}`,
      manifest.upload?.filename || `${manifest.job.id}.mp4`,
    )

    const report = await platformPut(base, reportPath, {
      status: 'rendered',
      output: {
        url: uploaded.url,
        storagePath: uploaded.storagePath,
        durationSeconds: compiled.durationSeconds,
        sizeBytes: uploaded.sizeBytes,
        sha256: uploaded.sha256,
      },
    })
    if (!report.ok) {
      await fail(
        `Render succeeded but the platform rejected completion (HTTP ${report.status}): ${(report.body || '').slice(0, 300)}`,
        'platform_complete_failed',
      )
      return
    }

    job.status = 'completed'
    job.providerStatus = 'completed'
    job.providerStatusMessage = 'Rendered by higgsfield-executor.'
    job.output = { kind: 'video', url: uploaded.url, storagePath: uploaded.storagePath, sha256: uploaded.sha256 }
    log('info', 'editor render completed', { jobId: manifest.job.id, sizeBytes: uploaded.sizeBytes, durationSeconds: compiled.durationSeconds })
  } catch (error) {
    await fail(`Executor error: ${String(error?.message || error).slice(0, 800)}`, 'executor_error')
  } finally {
    if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {})
    setTimeout(() => jobs.delete(job.providerJobId), JOB_TTL_MS).unref?.()
  }
}

async function executeMediaPreview(job, manifest) {
  const base = baseUrlFrom(manifest)
  const preview = manifest.preview
  const reportPath = manifest.report?.path
    || `/api/v1/video-editor/media-previews/${preview.id}?orgId=${encodeURIComponent(preview.orgId)}`
  const folder = manifest.upload?.folder || `video-editor/${preview.orgId}/previews`
  const safeKey = String(preview.mediaKey).replace(/[^A-Za-z0-9_-]/g, '_')

  const fail = async (message, code = 'preview_failed') => {
    job.status = 'failed'
    job.providerStatus = code
    job.providerStatusMessage = message.slice(0, 1500)
    log('error', 'media preview failed', { previewId: preview.id, code, message: job.providerStatusMessage })
    await platformPut(base, reportPath, { status: 'failed', error: { code, message: message.slice(0, 2000) } })
  }

  let workDir
  try {
    await platformPut(base, reportPath, { status: 'processing' })
    workDir = await mkdtemp(join(tmpdir(), 'vprev-'))
    const localFile = await downloadEditorMedia(preview.url, workDir, 0)
    const stats = await stat(localFile)
    const probe = await probeMedia(localFile)
    const report = { status: 'ready' }

    if (manifest.options?.waveform) {
      const pcm = await runFfmpegStdout(['-i', localFile, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], PREVIEW_TIMEOUT_MS)
      if (pcm.code === 0 && pcm.stdout.length) {
        const peaks = computePeaksFromPcm(pcm.stdout, Math.round(8000 / WAVEFORM_PEAKS_PER_SECOND))
        const payload = Buffer.from(JSON.stringify({ version: 1, peaksPerSecond: WAVEFORM_PEAKS_PER_SECOND, peaks }))
        const uploaded = await uploadPreviewArtifact(base, payload, preview.orgId, folder, `${safeKey}-waveform.json`, 'application/json')
        report.waveform = { ...uploaded, peaksPerSecond: WAVEFORM_PEAKS_PER_SECOND, peakCount: peaks.length }
      } else {
        log('warn', 'waveform decode failed — continuing', { previewId: preview.id, stderr: pcm.stderr.slice(-200) })
      }
    }

    if (manifest.options?.filmstrip && probe.durationSeconds > 0) {
      const frameCount = Math.min(40, Math.max(5, Math.round(probe.durationSeconds / 2)))
      const interval = probe.durationSeconds / frameCount
      const stripPath = join(workDir, 'filmstrip.jpg')
      const result = await runFfmpeg([
        '-y', '-i', localFile,
        '-vf', `fps=1/${fmtNumber(interval)},scale=160:-2,tile=${frameCount}x1`,
        '-frames:v', '1', '-q:v', '5', stripPath,
      ], PREVIEW_TIMEOUT_MS)
      if (result.code === 0) {
        const buffer = await readFile(stripPath)
        const uploaded = await uploadPreviewArtifact(base, buffer, preview.orgId, folder, `${safeKey}-filmstrip.jpg`, 'image/jpeg')
        const frameHeight = probe.width > 0 ? Math.round((160 / probe.width) * probe.height / 2) * 2 : 90
        report.filmstrip = { ...uploaded, frameIntervalSeconds: Math.round(interval * 1000) / 1000, frameWidth: 160, frameHeight, frameCount }
      } else {
        log('warn', 'filmstrip render failed — continuing', { previewId: preview.id, stderr: result.stderr.slice(-200) })
      }
    }

    if (manifest.options?.proxy && stats.size >= PROXY_MIN_BYTES) {
      const proxyPath = join(workDir, 'proxy.mp4')
      const scale = probe.height > 540 ? 'scale=-2:540' : 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
      const result = await runFfmpeg([
        '-y', '-i', localFile, '-vf', scale,
        '-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', proxyPath,
      ], PREVIEW_TIMEOUT_MS)
      if (result.code === 0) {
        const proxyStats = await stat(proxyPath)
        // LRU eviction BEFORE uploading the new proxy so the org stays under cap.
        const capBytes = Number(manifest.proxyLedger?.capBytes) || 20 * 1024 * 1024 * 1024
        const listPath = manifest.proxyLedger?.listPath
        const deleteTemplate = manifest.proxyLedger?.deletePathTemplate
        if (listPath && deleteTemplate) {
          const ledger = await platformGet(base, listPath)
          if (ledger.ok) {
            let totalBytes = Number(ledger.body?.totalBytes) || 0
            const entries = Array.isArray(ledger.body?.entries) ? ledger.body.entries : []
            for (const entry of entries) {
              if (totalBytes + proxyStats.size <= capBytes) break
              if (!entry?.id) continue
              const evicted = await platformDelete(base, deleteTemplate.replace('{id}', encodeURIComponent(entry.id)))
              if (evicted) {
                totalBytes -= Number(entry.sizeBytes) || 0
                log('info', 'evicted LRU proxy', { previewId: preview.id, evictedId: entry.id })
              }
            }
          }
        }
        const buffer = await readFile(proxyPath)
        const uploaded = await uploadPreviewArtifact(base, buffer, preview.orgId, folder, `${safeKey}-proxy540.mp4`, 'video/mp4')
        const proxyProbe = await probeMedia(proxyPath)
        report.proxy = { ...uploaded, sizeBytes: proxyStats.size, width: proxyProbe.width || 960, height: proxyProbe.height || 540 }
      } else {
        log('warn', 'proxy transcode failed — continuing', { previewId: preview.id, stderr: result.stderr.slice(-200) })
      }
    }

    const put = await platformPut(base, reportPath, report)
    if (!put.ok) {
      await fail(`Preview generated but the platform rejected the report (HTTP ${put.status})`, 'platform_report_failed')
      return
    }
    job.status = 'completed'
    job.providerStatus = 'completed'
    job.providerStatusMessage = 'Media preview generated.'
    log('info', 'media preview completed', {
      previewId: preview.id,
      waveform: Boolean(report.waveform),
      filmstrip: Boolean(report.filmstrip),
      proxy: Boolean(report.proxy),
    })
  } catch (error) {
    await fail(`Executor error: ${String(error?.message || error).slice(0, 800)}`, 'executor_error')
  } finally {
    if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {})
    setTimeout(() => jobs.delete(job.providerJobId), JOB_TTL_MS).unref?.()
  }
}

async function executeEditorTranscription(job, manifest) {
  const base = baseUrlFrom(manifest)
  const reportPath = manifest.report?.path
    || `/api/v1/video-editor/transcripts/${manifest.job.id}?orgId=${encodeURIComponent(manifest.job.orgId)}`

  const fail = async (message, code = 'transcription_error') => {
    job.status = 'failed'
    job.providerStatus = code
    job.providerStatusMessage = message.slice(0, 1500)
    log('error', 'transcription failed', { jobId: manifest.job.id, code, message: job.providerStatusMessage })
    await platformPut(base, reportPath, { status: 'failed', error: { code, message: message.slice(0, 4000) } })
  }

  let workDir
  try {
    await platformPut(base, reportPath, { status: 'processing' })
    workDir = await mkdtemp(join(tmpdir(), 'vtrans-'))

    const mediaFile = await downloadEditorMedia(manifest.media.url, workDir, 0)
    const audioFile = join(workDir, 'audio.mp3')
    const extract = await runFfmpeg(audioExtractArgs(mediaFile, audioFile), 10 * 60 * 1000)
    if (extract.code !== 0) {
      await fail(`ffmpeg audio extraction exited ${extract.code}: ${extract.stderr.trim().slice(-800)}`, 'audio_extract_failed')
      return
    }

    // BYOK (per-job, never persisted) beats the platform gateway defaults.
    const byok = manifest.byok && typeof manifest.byok.apiKey === 'string' ? manifest.byok : null
    const baseUrl = (byok?.baseUrl || (byok ? 'https://api.openai.com/v1' : TRANSCRIBE_BASE_URL)).replace(/\/$/, '')
    const apiKey = byok ? byok.apiKey : TRANSCRIBE_API_KEY
    const model = byok?.model || (byok ? TRANSCRIBE_BYOK_DEFAULT_MODEL : TRANSCRIBE_MODEL)
    if (!apiKey) {
      await fail('No transcription credential available (set TRANSCRIBE_API_KEY or supply BYOK)', 'transcription_not_configured')
      return
    }

    const form = new FormData()
    form.set('file', new Blob([await readFile(audioFile)], { type: 'audio/mpeg' }), 'audio.mp3')
    form.set('model', model)
    form.set('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'word')
    form.append('timestamp_granularities[]', 'segment')
    if (typeof manifest.language === 'string' && manifest.language && manifest.language !== 'auto') {
      form.set('language', manifest.language)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), EDITOR_TRANSCRIBE_TIMEOUT_MS)
    let response
    try {
      response = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    const text = await response.text().catch(() => '')
    if (!response.ok) {
      await fail(`Transcription provider rejected the request (${response.status}): ${text.slice(0, 500)}`, 'provider_rejected')
      return
    }
    let payload = {}
    try { payload = JSON.parse(text) } catch { payload = {} }
    const mapped = segmentsFromVerboseJson(payload)
    if (!mapped.segments.length) {
      await fail('Provider returned no usable segments', 'empty_transcription')
      return
    }

    const report = await platformPut(base, reportPath, {
      status: 'completed',
      segments: mapped.segments,
      ...(mapped.language ? { language: mapped.language } : {}),
      ...(mapped.durationSeconds !== undefined ? { durationSeconds: mapped.durationSeconds } : {}),
    })
    if (!report.ok) {
      await fail(`Transcription succeeded but the platform rejected completion (HTTP ${report.status}): ${(report.body || '').slice(0, 300)}`, 'platform_complete_failed')
      return
    }

    job.status = 'completed'
    job.providerStatus = 'completed'
    job.providerStatusMessage = 'Transcribed by higgsfield-executor.'
    log('info', 'transcription completed', { jobId: manifest.job.id, segments: mapped.segments.length })
  } catch (error) {
    await fail(`Executor error: ${String(error?.message || error).slice(0, 800)}`, 'executor_error')
  } finally {
    if (workDir) rm(workDir, { recursive: true, force: true }).catch(() => {})
    setTimeout(() => jobs.delete(job.providerJobId), JOB_TTL_MS).unref?.()
  }
}

function fmtNumber(value) {
  return String(Math.round(Number(value) * 1000) / 1000)
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

    // BYOK: if this run carries a per-connection Higgsfield key, scope it to the
    // CLI child process's env only (never process.env, never disk, never logs).
    const byokApiKey = typeof input.byokCredentials?.apiKey === 'string' ? input.byokCredentials.apiKey : undefined
    const byokApiSecret = typeof input.byokCredentials?.apiSecret === 'string' ? input.byokCredentials.apiSecret : undefined
    const cliEnvOverrides = byokApiKey
      ? { HF_API_KEY: byokApiKey, ...(byokApiSecret ? { HF_API_SECRET: byokApiSecret } : {}) }
      : undefined

    const mediaArgs = []
    const sourceMedia = Array.isArray(manifest.sourceMedia) ? manifest.sourceMedia : []
    for (let index = 0; index < sourceMedia.length; index += 1) {
      const media = sourceMedia[index]
      if (!media?.value || !media?.flag) continue
      const isRemote = /^https?:\/\//.test(media.value)
      let value = isRemote
        ? await downloadMedia(media.value, workDir, index)
        : media.value
      // Canvas video-split segments carry a trim window on the manifest entry.
      // Clip the downloaded file locally so the provider only bills the segment.
      if (isRemote && media.flag === '--video'
          && (media.trimStartSeconds !== undefined || media.trimEndSeconds !== undefined)) {
        value = await clipVideoSegment(value, media.trimStartSeconds ?? 0, media.trimEndSeconds, workDir, index)
      }
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
    let result = await runCli(buildArgs(extras), timeoutMs, cliEnvOverrides)
    if (result.code !== 0 && extras.length && /param|unknown flag|invalid|not allowed|unexpected/i.test(result.stderr + result.stdout)) {
      log('warn', 'retrying without optional params', { runId: run.id })
      result = await runCli(buildArgs([]), timeoutMs, cliEnvOverrides)
    }

    // Higgsfield runs an async IP/rights check on input media (image-to-video,
    // combines). When a run reuses media that was uploaded/generated moments
    // earlier, the provider may reject with "IP check not finished for input
    // media" before the check completes. That is transient — poll-retry the
    // same generate with backoff so the run self-heals once the check clears,
    // instead of failing a perfectly valid request. A prolonged provider-side
    // stall still ends in a retryable failure (credits are refunded on fail).
    const ipCheckPending = (r) => /IP check not finished/i.test(`${r.stderr}${r.stdout}`)
    if (result.code !== 0 && mediaArgs.length && ipCheckPending(result)) {
      for (let attempt = 1; attempt <= IP_CHECK_MAX_RETRIES && ipCheckPending(result); attempt += 1) {
        log('warn', 'input media IP check not finished — waiting to retry', { runId: run.id, attempt, delayMs: IP_CHECK_RETRY_MS })
        await sleep(IP_CHECK_RETRY_MS)
        result = await runCli(buildArgs(extras), timeoutMs, cliEnvOverrides)
      }
    }

    if (result.code !== 0) {
      const code = ipCheckPending(result) ? 'higgsfield_ip_check_pending' : 'higgsfield_cli_error'
      await fail(`Higgsfield CLI exited ${result.code}: ${(result.stderr || result.stdout).trim().slice(0, 400)}`, code)
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
    const completeResult = await platformPut(base, completePath, {
      outputNodeId: `${run.nodeId}-output`,
      output: { kind: outputKind, url: outputUrl, rawProviderJobId: providerJob },
      provenance: { providerJobId: providerJob || job.providerJobId, costLabel: 'higgsfield_executor' },
    })
    if (!completeResult.ok) {
      // Surface the platform's actual rejection reason (status + body) instead of a
      // generic message — platformPut already logs it as a warning, but that log line
      // is easy to miss next to the "run failed" line a human/agent actually searches for.
      const platformDetail = completeResult.body ? completeResult.body.slice(0, 300) : '(empty response body)'
      await fail(
        `Generation succeeded but the platform rejected run completion (HTTP ${completeResult.status}): ${platformDetail}`,
        'platform_complete_failed',
      )
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

    if (req.method === 'POST' && url.pathname === '/video-editor/renders') {
      const body = JSON.parse(await readBody(req) || 'null')
      if (body?.kind !== 'video_editor_render' || !body.job?.id || !body.job?.orgId || !body.job?.projectId
          || !body.timeline || !body.settings) {
        return json(res, 400, { error: 'Valid video_editor_render manifest is required' })
      }
      const providerJobId = `vedit-${body.job.id}-${randomUUID().slice(0, 8)}`
      const job = {
        providerJobId,
        jobId: body.job.id,
        status: 'running',
        providerStatus: 'executor_accepted',
        providerStatusMessage: 'Editor render accepted.',
        createdAt: Date.now(),
      }
      jobs.set(providerJobId, job)
      log('info', 'editor render accepted', { jobId: body.job.id, providerJobId, mediaCount: Array.isArray(body.media) ? body.media.length : 0 })
      executeEditorRender(job, body).catch((error) => log('error', 'executeEditorRender crashed', { jobId: body.job.id, error: String(error) }))
      return json(res, 200, { providerJobId, status: 'running', providerStatus: job.providerStatus, providerStatusMessage: job.providerStatusMessage })
    }

    if (req.method === 'POST' && url.pathname === '/video-editor/transcriptions') {
      const body = JSON.parse(await readBody(req) || 'null')
      if (body?.kind !== 'video_editor_transcription' || !body.job?.id || !body.job?.orgId || !body.job?.projectId
          || !body.media?.url) {
        return json(res, 400, { error: 'Valid video_editor_transcription manifest is required' })
      }
      const providerJobId = `vtx-${body.job.id}-${randomUUID().slice(0, 8)}`
      const job = {
        providerJobId,
        jobId: body.job.id,
        status: 'running',
        providerStatus: 'executor_accepted',
        providerStatusMessage: 'Transcription accepted.',
        createdAt: Date.now(),
      }
      jobs.set(providerJobId, job)
      log('info', 'transcription accepted', { jobId: body.job.id, providerJobId, byok: Boolean(body.byok) })
      executeEditorTranscription(job, body).catch((error) => log('error', 'executeEditorTranscription crashed', { jobId: body.job.id, error: String(error) }))
      return json(res, 200, { providerJobId, status: 'running', providerStatus: job.providerStatus, providerStatusMessage: job.providerStatusMessage })
    }

    const transcriptionStatusMatch = url.pathname.match(/^\/video-editor\/transcriptions\/([A-Za-z0-9-]+)$/)
    if (req.method === 'GET' && transcriptionStatusMatch) {
      const job = jobs.get(transcriptionStatusMatch[1])
      if (!job) return json(res, 404, { error: 'Job not found' })
      return json(res, 200, {
        providerJobId: job.providerJobId,
        status: job.status,
        providerStatus: job.providerStatus,
        providerStatusMessage: job.providerStatusMessage,
      })
    }

    if (req.method === 'POST' && url.pathname === '/video-editor/media-previews') {
      const body = JSON.parse(await readBody(req) || 'null')
      if (body?.kind !== 'video_editor_media_preview' || !body.preview?.id || !body.preview?.orgId || !body.preview?.url) {
        return json(res, 400, { error: 'Valid video_editor_media_preview manifest is required' })
      }
      const providerJobId = `vprev-${body.preview.id}-${randomUUID().slice(0, 8)}`
      const job = {
        providerJobId,
        previewId: body.preview.id,
        status: 'running',
        providerStatus: 'executor_accepted',
        providerStatusMessage: 'Media preview accepted.',
        createdAt: Date.now(),
      }
      jobs.set(providerJobId, job)
      log('info', 'media preview accepted', { previewId: body.preview.id, providerJobId, mediaKind: body.preview.mediaKind })
      executeMediaPreview(job, body).catch((error) => log('error', 'executeMediaPreview crashed', { previewId: body.preview.id, error: String(error) }))
      return json(res, 200, { providerJobId, status: 'running', providerStatus: job.providerStatus, providerStatusMessage: job.providerStatusMessage })
    }

    const previewStatusMatch = url.pathname.match(/^\/video-editor\/media-previews\/([A-Za-z0-9-]+)$/)
    if (req.method === 'GET' && previewStatusMatch) {
      const job = jobs.get(previewStatusMatch[1])
      if (!job) return json(res, 404, { error: 'Job not found' })
      return json(res, 200, {
        providerJobId: job.providerJobId,
        status: job.status,
        providerStatus: job.providerStatus,
        providerStatusMessage: job.providerStatusMessage,
      })
    }

    const editorStatusMatch = url.pathname.match(/^\/video-editor\/renders\/([A-Za-z0-9-]+)$/)
    if (req.method === 'GET' && editorStatusMatch) {
      const job = jobs.get(editorStatusMatch[1])
      if (!job) return json(res, 404, { error: 'Job not found' })
      return json(res, 200, {
        providerJobId: job.providerJobId,
        status: job.status,
        providerStatus: job.providerStatus,
        providerStatusMessage: job.providerStatusMessage,
        ...(job.output ? { output: job.output } : {}),
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
