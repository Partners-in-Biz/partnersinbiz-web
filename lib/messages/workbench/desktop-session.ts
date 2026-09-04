/**
 * Pure desktop-session types and lease guards.
 * Safe for client and tests — no Firebase Admin imports.
 */

export type DesktopSessionStatus =
  | 'awaiting_approval'
  | 'queued'
  | 'claimed'
  | 'running'
  | 'exited'
  | 'killed'
  | 'expired'
  | 'failed'

export type DesktopSessionDriver = 'agent' | 'user'

/** Actor that is requesting a driver change or enqueuing a control. */
export type DesktopSessionActorKind = 'agent' | 'user'

/** Controls that move the desktop — blocked while the other actor owns the wheel. */
export const DESKTOP_DRIVING_CONTROL_KINDS = ['click', 'type', 'press', 'scroll'] as const

export function isDesktopDrivingControl(control: Record<string, unknown> | null | undefined): boolean {
  const kind = typeof control?.kind === 'string' ? control.kind : ''
  return (DESKTOP_DRIVING_CONTROL_KINDS as ReadonlyArray<string>).includes(kind)
}

export const TERMINAL_DESKTOP_SESSION_STATUSES: ReadonlyArray<DesktopSessionStatus> = [
  'exited',
  'killed',
  'expired',
  'failed',
]

export type DesktopSession = {
  sessionId: string
  conversationId: string
  orgId: string
  deviceId: string
  runtimeTargetId: string
  credentialVersion: number
  status: DesktopSessionStatus
  driver: DesktopSessionDriver
  latestFrameUrl: string | null
  frameCount: number
  screenWidth: number
  screenHeight: number
  leaseToken: string | null
  pendingControls: Array<Record<string, unknown>>
  createdAtMs: number
  updatedAtMs: number
  ttlExpiresAtMs: number
}

export type PublicDesktopSession = {
  sessionId: string
  conversationId?: string
  status: string
  driver: DesktopSessionDriver
  latestFrameUrl: string | null
  frameCount?: number
  screenWidth: number
  screenHeight: number
  sessionKind?: 'desktop'
}

export function isTerminalDesktopSessionStatus(status: string | null | undefined): boolean {
  return status === 'exited' || status === 'killed' || status === 'expired' || status === 'failed'
}

export function assertLiveDesktopLease(session: Pick<DesktopSession, 'deviceId' | 'status' | 'leaseToken' | 'credentialVersion'>, input: {
  deviceId: string
  leaseToken: string
  credentialVersion?: number
}): void {
  if (session.deviceId !== input.deviceId) throw new Error('device mismatch')
  if (input.credentialVersion != null && session.credentialVersion !== input.credentialVersion) {
    throw new Error('credential mismatch')
  }
  if (isTerminalDesktopSessionStatus(session.status)) throw new Error('desktop session already final')
  if (session.status !== 'claimed' && session.status !== 'running') throw new Error('desktop session not claimed')
  if (!session.leaseToken || session.leaseToken !== input.leaseToken) throw new Error('lease mismatch')
}

export function assertDesktopSessionComplete(session: Pick<DesktopSession, 'deviceId' | 'status' | 'leaseToken' | 'credentialVersion'>, input: {
  deviceId: string
  credentialVersion: number
  leaseToken?: string
}): void {
  if (session.deviceId !== input.deviceId) throw new Error('device mismatch')
  if (session.credentialVersion !== input.credentialVersion) throw new Error('credential mismatch')
  if (isTerminalDesktopSessionStatus(session.status)) return
  if (!input.leaseToken || !session.leaseToken || session.leaseToken !== input.leaseToken) {
    throw new Error('lease mismatch')
  }
}

/** Map store/auth errors onto device-route HTTP status. Lease/terminal beat generic "mismatch". */
export function desktopSessionHttpStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/not found/i.test(message)) return 404
  if (/already final|not claimed|lease|being driven/i.test(message)) return 409
  if (/authentication|signature|credential|device mismatch|denied/i.test(message)) return 403
  return 500
}

export function parsePublicDesktopSession(payload: unknown): PublicDesktopSession | null {
  const envelope = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  const data = envelope && envelope.data && typeof envelope.data === 'object'
    ? envelope.data as Record<string, unknown>
    : envelope
  if (!data || typeof data.sessionId !== 'string' || !data.sessionId) return null
  return {
    sessionId: data.sessionId,
    conversationId: typeof data.conversationId === 'string' ? data.conversationId : undefined,
    status: typeof data.status === 'string' ? data.status : 'queued',
    driver: data.driver === 'user' ? 'user' : 'agent',
    latestFrameUrl: typeof data.latestFrameUrl === 'string' ? data.latestFrameUrl : null,
    frameCount: typeof data.frameCount === 'number' ? data.frameCount : undefined,
    screenWidth: typeof data.screenWidth === 'number' ? data.screenWidth : 1440,
    screenHeight: typeof data.screenHeight === 'number' ? data.screenHeight : 900,
    sessionKind: 'desktop',
  }
}
