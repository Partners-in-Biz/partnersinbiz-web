/**
 * Vision bridge for the finish gate — turn screenshots into structured
 * transcripts the fresh reviewer can reason over (ModLens, @liustack/modlens
 * v2.7.1, provider gemini-api). Graceful: missing binary / provider / failure
 * yields an empty transcript and a note, never a throw — the gate still runs.
 *
 * The fresh reviewer (or its text-only host model) can then inspect OCR +
 * layout regions instead of raw pixels, which is exactly the ModLens/vision
 * path named in research P2 for screenshot evidence.
 *
 * Defaults are read from the real ModLens config (~/.modlens/config.json)
 * when present so the happy path works out of the box for the configured
 * provider; --model/--provider overrides win.
 */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export interface VisionResult {
  transcript: string
  ok: boolean
  error?: string
}

export interface RunVisionOptions {
  /** Override binary path (default: `modlens` on PATH). */
  binary?: string
  /** Override model, e.g. gemini-3.6-flash for the gemini-api provider. */
  model?: string
  /** Override provider (modlens --provider). */
  provider?: string
  prompt?: string
  timeoutMs?: number
  /** Test hook: run a fake binary returning this stdout. */
  _fakeStdout?: string
}

interface ModLensConfig {
  provider?: string
  providers?: Record<string, { model?: string }>
}

const FALLBACK_MODEL = 'gemini-3.6-flash'
const FALLBACK_PROVIDER = 'gemini-api'

/** Read the real ModLens config to resolve the configured provider/model. */
export function readModLensConfig(): ModLensConfig {
  try {
    const configPath = path.join(os.homedir(), '.modlens', 'config.json')
    if (!fs.existsSync(configPath)) return {}
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as ModLensConfig
  } catch {
    return {}
  }
}

/** Resolve the default model for the configured provider (config-aware). */
export function resolveDefaultModel(): string {
  const config = readModLensConfig()
  const provider = config.provider ?? FALLBACK_PROVIDER
  const configuredModel = config.providers?.[provider]?.model
  return configuredModel || FALLBACK_MODEL
}

/** Resolve the default provider from ModLens config. */
export function resolveDefaultProvider(): string {
  return readModLensConfig().provider ?? FALLBACK_PROVIDER
}

/** Run ModLens on one image and return a compact transcript (never throws). */
export function runVisionTranscript(imagePath: string, opts: RunVisionOptions = {}): VisionResult {
  try {
    if (!fs.existsSync(imagePath)) return { transcript: '', ok: false, error: `image not found: ${imagePath}` }
    if (opts._fakeStdout !== undefined) return { transcript: summarizeModLens(opts._fakeStdout), ok: true }
    const binary = opts.binary ?? 'modlens'
    const args = [
      'analyze',
      '-i',
      imagePath,
      '-m',
      opts.model ?? resolveDefaultModel(),
      '-p',
      opts.provider ?? resolveDefaultProvider(),
    ]
    if (opts.prompt) args.push('--prompt', opts.prompt)
    const stdout = execFileSync(binary, args, {
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? 60_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const transcript = summarizeModLens(stdout)
    return { transcript, ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { transcript: '', ok: false, error: msg }
  }
}

/** Build transcripts for many screenshots, keyed by absolute path. */
export function buildVisionTranscripts(
  screenshotPaths: string[],
  opts: RunVisionOptions = {},
): { transcripts: Record<string, string>; notes: string[] } {
  const transcripts: Record<string, string> = {}
  const notes: string[] = []
  for (const p of screenshotPaths) {
    const result = runVisionTranscript(p, opts)
    if (result.ok && result.transcript) transcripts[p] = result.transcript
    else if (result.error) notes.push(`${p}: ${result.error}`)
  }
  return { transcripts, notes }
}

/** Compact, human-readable summary of ModLens JSON output. */
export function summarizeModLens(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as {
      result?: {
        summary?: string
        ocr?: { full_text?: string }
        layout?: { regions?: Array<{ label?: string; text?: string; kind?: string }> }
        entities?: unknown[]
        uncertainty?: unknown[]
      }
      provider?: string
    }
    const parts: string[] = []
    if (parsed.provider) parts.push(`provider=${parsed.provider}`)
    if (parsed.result?.summary) parts.push(`summary: ${parsed.result.summary}`)
    if (parsed.result?.ocr?.full_text) parts.push(`ocr: ${parsed.result.ocr.full_text}`)
    if (parsed.result?.layout?.regions?.length) {
      const regions = parsed.result.layout.regions
        .map((r) => `${r.kind ?? 'region'}${r.label ? ` ${r.label}` : ''}${r.text ? `: ${r.text}` : ''}`)
        .join(' | ')
      parts.push(`layout: ${regions}`)
    }
    if (parsed.result?.uncertainty?.length) parts.push(`uncertainty: ${JSON.stringify(parsed.result.uncertainty)}`)
    return parts.join('\n')
  } catch {
    // Not JSON — keep raw text, truncated.
    return stdout.slice(0, 6000)
  }
}
