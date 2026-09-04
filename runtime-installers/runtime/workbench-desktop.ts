/**
 * Mac desktop watch + take-over (Phase 2).
 *
 * Capture: `screencapture` JPEG loop when Screen Recording is granted.
 * Input: `pib-input` CLI (CGEvent) when Accessibility is granted.
 * Advertises `desktop.watch` / `desktop.control` via heartbeat probes.
 *
 * No WebRTC/VNC — same frame-upload + control-claim pattern as workbench-browser.
 */
import { spawn, execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const DESKTOP_FOLLOW_INTERVAL_MS = 750
export const DESKTOP_MAX_EDGE = 1280

export type DesktopCapabilityProbe = {
  watch: boolean
  control: boolean
  watchError?: string
  controlError?: string
}

export type DesktopControl =
  | { kind: 'follow_start'; intervalMs?: number }
  | { kind: 'follow_stop' }
  | { kind: 'click'; x: number; y: number; button?: 'left' | 'right' }
  | { kind: 'type'; text: string; sensitive?: boolean }
  | { kind: 'press'; key: string }
  | { kind: 'scroll'; x: number; y: number; deltaY: number }
  | { kind: 'kill' }

export type DesktopClaim =
  | {
    kind: 'create'
    sessionId: string
    attempt: number
    leaseToken: string
    screenWidth?: number
    screenHeight?: number
  }
  | {
    kind: 'control'
    sessionId: string
    control: DesktopControl
    attempt: number
    leaseToken: string
  }

export type PostFn = (path: string, body: Record<string, unknown>) => Promise<Response>

type DesktopEntry = {
  sessionId: string
  leaseToken: string
  attempt: number
  followTimer: ReturnType<typeof setInterval> | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  seq: number
  finished: boolean
  screenWidth: number
  screenHeight: number
}

const desktops = new Map<string, DesktopEntry>()

function defaultWait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function workbenchPollDelay(delay: number) {
  return Math.min(Math.max(delay, 250), 8_000)
}

/** Probe Screen Recording by capturing a tiny frame to a temp file. */
export async function probeDesktopWatch(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'darwin') return { ok: false, error: 'desktop.watch requires macOS' }
  const tmp = path.join(os.tmpdir(), `pib-desktop-probe-${process.pid}.jpg`)
  try {
    await execFileAsync('screencapture', ['-x', '-t', 'jpg', '-R', '0,0,32,32', tmp], { timeout: 5_000 })
    const stat = await fs.stat(tmp).catch(() => null)
    await fs.unlink(tmp).catch(() => undefined)
    if (!stat || stat.size < 32) return { ok: false, error: 'Screen Recording permission missing' }
    return { ok: true }
  } catch (error) {
    await fs.unlink(tmp).catch(() => undefined)
    return { ok: false, error: error instanceof Error ? error.message : 'screencapture failed' }
  }
}

/** Probe Accessibility by attempting a no-op move via pib-input (or osascript fallback). */
export async function probeDesktopControl(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'darwin') return { ok: false, error: 'desktop.control requires macOS' }
  try {
    await runPibInput(['ping'])
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Accessibility permission missing' }
  }
}

export async function probeDesktopCapabilities(): Promise<DesktopCapabilityProbe> {
  if (process.platform !== 'darwin') {
    return { watch: false, control: false, watchError: 'not macOS', controlError: 'not macOS' }
  }
  const [watch, control] = await Promise.all([probeDesktopWatch(), probeDesktopControl()])
  return {
    watch: watch.ok,
    control: control.ok,
    ...(watch.error ? { watchError: watch.error } : {}),
    ...(control.error ? { controlError: control.error } : {}),
  }
}

function pibInputBin(): string {
  const fromEnv = process.env.PIB_INPUT_BIN?.trim()
  if (fromEnv) return fromEnv
  // Bundled next to the runtime binary when signed builds ship it.
  return path.join(path.dirname(process.execPath), 'pib-input')
}

async function runPibInput(args: string[]): Promise<void> {
  const bin = pibInputBin()
  try {
    await execFileAsync(bin, args, { timeout: 3_000 })
    return
  } catch {
    // Fallback: AppleScript click/keystroke (requires Accessibility; no binary needed).
    if (args[0] === 'ping') {
      await execFileAsync('osascript', ['-e', 'tell application "System Events" to get name'], { timeout: 3_000 })
      return
    }
    if (args[0] === 'click' && args[1] && args[2]) {
      const x = Number(args[1])
      const y = Number(args[2])
      await execFileAsync('osascript', [
        '-e',
        `tell application "System Events" to click at {${x}, ${y}}`,
      ], { timeout: 3_000 })
      return
    }
    if (args[0] === 'type' && args[1] !== undefined) {
      const text = args.slice(1).join(' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      await execFileAsync('osascript', [
        '-e',
        `tell application "System Events" to keystroke "${text}"`,
      ], { timeout: 5_000 })
      return
    }
    if (args[0] === 'key' && args[1]) {
      await execFileAsync('osascript', [
        '-e',
        `tell application "System Events" to key code ${Number(args[1]) || 36}`,
      ], { timeout: 3_000 })
      return
    }
    throw new Error('pib-input unavailable and no osascript fallback for this control')
  }
}

export async function captureDesktopJpeg(): Promise<Buffer> {
  const tmp = path.join(os.tmpdir(), `pib-desktop-frame-${process.pid}-${Date.now()}.jpg`)
  try {
    await execFileAsync('screencapture', ['-x', '-C', '-t', 'jpg', tmp], { timeout: 8_000 })
    const bytes = await fs.readFile(tmp)
    await fs.unlink(tmp).catch(() => undefined)
    return bytes
  } catch (error) {
    await fs.unlink(tmp).catch(() => undefined)
    throw error
  }
}

async function uploadFrame(entry: DesktopEntry, post: PostFn, deviceId: string): Promise<void> {
  const bytes = await captureDesktopJpeg()
  const dataBase64 = bytes.toString('base64')
  entry.seq += 1
  await post(
    `/api/v1/linked-computers/${encodeURIComponent(deviceId)}/workbench/desktop/sessions/${encodeURIComponent(entry.sessionId)}/frames`,
    {
      attempt: entry.attempt,
      leaseToken: entry.leaseToken,
      seq: entry.seq,
      contentType: 'image/jpeg',
      dataBase64,
      screenWidth: entry.screenWidth,
      screenHeight: entry.screenHeight,
    },
  )
}

function removeDesktop(sessionId: string, entry: DesktopEntry) {
  if (entry.followTimer) clearInterval(entry.followTimer)
  if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer)
  entry.followTimer = null
  entry.heartbeatTimer = null
  desktops.delete(sessionId)
}

export async function handleDesktopCreate(
  claim: Extract<DesktopClaim, { kind: 'create' }>,
  post: PostFn,
  deviceId: string,
): Promise<void> {
  const entry: DesktopEntry = {
    sessionId: claim.sessionId,
    leaseToken: claim.leaseToken,
    attempt: claim.attempt,
    followTimer: null,
    heartbeatTimer: null,
    seq: 0,
    finished: false,
    screenWidth: claim.screenWidth ?? 1440,
    screenHeight: claim.screenHeight ?? 900,
  }
  desktops.set(claim.sessionId, entry)
  entry.heartbeatTimer = setInterval(() => {
    void post(
      `/api/v1/linked-computers/${encodeURIComponent(deviceId)}/workbench/desktop/sessions/${encodeURIComponent(claim.sessionId)}/progress`,
      { attempt: claim.attempt, leaseToken: claim.leaseToken, stream: 'heartbeat' },
    ).catch(() => undefined)
  }, 30_000)
  // First frame so the UI has something immediately.
  await uploadFrame(entry, post, deviceId).catch(() => undefined)
}

export async function runDesktopClaim(
  claim: DesktopClaim,
  post: PostFn,
  deviceId: string,
): Promise<void> {
  if (claim.kind === 'create') {
    await handleDesktopCreate(claim, post, deviceId)
    return
  }
  const entry = desktops.get(claim.sessionId)
  if (!entry || entry.finished) return
  const control = claim.control
  if (control.kind === 'follow_start') {
    if (entry.followTimer) clearInterval(entry.followTimer)
    const interval = control.intervalMs && control.intervalMs >= 400
      ? control.intervalMs
      : DESKTOP_FOLLOW_INTERVAL_MS
    entry.followTimer = setInterval(() => {
      void uploadFrame(entry, post, deviceId).catch(() => undefined)
    }, interval)
    return
  }
  if (control.kind === 'follow_stop') {
    if (entry.followTimer) clearInterval(entry.followTimer)
    entry.followTimer = null
    return
  }
  if (control.kind === 'kill') {
    entry.finished = true
    removeDesktop(claim.sessionId, entry)
    await post(
      `/api/v1/linked-computers/${encodeURIComponent(deviceId)}/workbench/desktop/sessions/${encodeURIComponent(claim.sessionId)}/complete`,
      { attempt: claim.attempt, leaseToken: claim.leaseToken, status: 'killed' },
    ).catch(() => undefined)
    return
  }
  if (control.kind === 'click') {
    await runPibInput(['click', String(Math.round(control.x)), String(Math.round(control.y))])
    return
  }
  if (control.kind === 'type') {
    // Sensitive text is never logged — only forwarded to the input helper.
    await runPibInput(['type', control.text])
    return
  }
  if (control.kind === 'press') {
    await runPibInput(['key', control.key])
    return
  }
  if (control.kind === 'scroll') {
    await runPibInput(['scroll', String(Math.round(control.x)), String(Math.round(control.y)), String(control.deltaY)])
  }
}

export function sweepExpiredDesktopSessions(): void {
  // Sessions are cleaned when kill/complete arrives; no local TTL table yet.
}

export async function pollWorkbenchDesktopForever(
  claim: () => Promise<DesktopClaim | null>,
  run: (claim: DesktopClaim) => Promise<unknown>,
  stop: () => boolean = () => false,
  wait: (milliseconds: number) => Promise<unknown> = defaultWait,
): Promise<void> {
  let delay = 250
  while (!stop()) {
    sweepExpiredDesktopSessions()
    const claimed = await claim().catch(() => null)
    if (claimed) {
      delay = 250
      await run(claimed).catch(() => undefined)
    } else {
      await wait(workbenchPollDelay(delay))
      delay = Math.min(delay * 2, 8_000)
    }
  }
}

/** Avoid unused import warnings when bundlers tree-shake spawn. */
void spawn
