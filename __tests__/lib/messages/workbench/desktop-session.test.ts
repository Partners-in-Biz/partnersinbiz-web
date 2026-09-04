import {
  assertDesktopSessionComplete,
  assertLiveDesktopLease,
  desktopSessionHttpStatus,
  isDesktopDrivingControl,
  isTerminalDesktopSessionStatus,
  parsePublicDesktopSession,
  type DesktopSession,
} from '@/lib/messages/workbench/desktop-session'

function session(overrides: Partial<DesktopSession> = {}): DesktopSession {
  return {
    sessionId: 'desk_a',
    conversationId: 'conv-a',
    orgId: 'org-a',
    deviceId: 'device-a',
    runtimeTargetId: 'runtime-a',
    credentialVersion: 3,
    status: 'running',
    driver: 'agent',
    latestFrameUrl: null,
    frameCount: 0,
    screenWidth: 1440,
    screenHeight: 900,
    leaseToken: 'lease-a',
    pendingControls: [],
    createdAtMs: 1,
    updatedAtMs: 1,
    ttlExpiresAtMs: 100_000,
    ...overrides,
  }
}

describe('isDesktopDrivingControl', () => {
  it('treats click/type/press/scroll as driving and follow/kill as not', () => {
    expect(isDesktopDrivingControl({ kind: 'click' })).toBe(true)
    expect(isDesktopDrivingControl({ kind: 'type' })).toBe(true)
    expect(isDesktopDrivingControl({ kind: 'press' })).toBe(true)
    expect(isDesktopDrivingControl({ kind: 'scroll' })).toBe(true)
    expect(isDesktopDrivingControl({ kind: 'follow_start' })).toBe(false)
    expect(isDesktopDrivingControl({ kind: 'kill' })).toBe(false)
    expect(isDesktopDrivingControl({})).toBe(false)
  })
})

describe('isTerminalDesktopSessionStatus', () => {
  it('treats exited, killed, expired, and failed as final', () => {
    expect(isTerminalDesktopSessionStatus('exited')).toBe(true)
    expect(isTerminalDesktopSessionStatus('killed')).toBe(true)
    expect(isTerminalDesktopSessionStatus('expired')).toBe(true)
    expect(isTerminalDesktopSessionStatus('failed')).toBe(true)
    expect(isTerminalDesktopSessionStatus('running')).toBe(false)
    expect(isTerminalDesktopSessionStatus('claimed')).toBe(false)
  })
})

describe('assertLiveDesktopLease', () => {
  const live = { deviceId: 'device-a', leaseToken: 'lease-a', credentialVersion: 3 }

  it('accepts claimed or running sessions with a matching live lease', () => {
    expect(() => assertLiveDesktopLease(session({ status: 'claimed' }), live)).not.toThrow()
    expect(() => assertLiveDesktopLease(session({ status: 'running' }), live)).not.toThrow()
  })

  it('rejects frames after the session is already final', () => {
    expect(() => assertLiveDesktopLease(session({ status: 'killed', leaseToken: null }), live))
      .toThrow(/already final/)
    expect(() => assertLiveDesktopLease(session({ status: 'exited', leaseToken: null }), live))
      .toThrow(/already final/)
  })

  it('rejects queued or awaiting sessions that have not been claimed', () => {
    expect(() => assertLiveDesktopLease(session({ status: 'queued' }), live)).toThrow(/not claimed/)
    expect(() => assertLiveDesktopLease(session({ status: 'awaiting_approval' }), live)).toThrow(/not claimed/)
  })

  it('rejects a device, credential, or lease mismatch', () => {
    expect(() => assertLiveDesktopLease(session(), { ...live, deviceId: 'other' })).toThrow(/device mismatch/)
    expect(() => assertLiveDesktopLease(session(), { ...live, credentialVersion: 9 })).toThrow(/credential mismatch/)
    expect(() => assertLiveDesktopLease(session(), { ...live, leaseToken: 'other' })).toThrow(/lease mismatch/)
    expect(() => assertLiveDesktopLease(session({ leaseToken: null }), live)).toThrow(/lease mismatch/)
  })
})

describe('assertDesktopSessionComplete', () => {
  const identity = { deviceId: 'device-a', credentialVersion: 3, leaseToken: 'lease-a' }

  it('is idempotent once the session is already final', () => {
    expect(() => assertDesktopSessionComplete(session({ status: 'killed', leaseToken: null }), identity)).not.toThrow()
    expect(() => assertDesktopSessionComplete(session({ status: 'exited', leaseToken: null }), { ...identity, leaseToken: undefined })).not.toThrow()
  })

  it('requires a matching live lease on a still-open session', () => {
    expect(() => assertDesktopSessionComplete(session(), identity)).not.toThrow()
    expect(() => assertDesktopSessionComplete(session(), { ...identity, leaseToken: 'other' })).toThrow(/lease mismatch/)
    expect(() => assertDesktopSessionComplete(session(), { ...identity, leaseToken: undefined })).toThrow(/lease mismatch/)
  })

  it('binds complete to the session device and credential version', () => {
    expect(() => assertDesktopSessionComplete(session(), { ...identity, deviceId: 'other' })).toThrow(/device mismatch/)
    expect(() => assertDesktopSessionComplete(session(), { ...identity, credentialVersion: 1 })).toThrow(/credential mismatch/)
  })
})

describe('desktopSessionHttpStatus', () => {
  it('maps lease and terminal errors to 409 before generic mismatch', () => {
    expect(desktopSessionHttpStatus(new Error('lease mismatch'))).toBe(409)
    expect(desktopSessionHttpStatus(new Error('desktop session already final'))).toBe(409)
    expect(desktopSessionHttpStatus(new Error('desktop session not claimed'))).toBe(409)
    expect(desktopSessionHttpStatus(new Error('workbench: desktop session is being driven by the user'))).toBe(409)
  })

  it('maps auth and device binding errors to 403 and missing sessions to 404', () => {
    expect(desktopSessionHttpStatus(new Error('credential mismatch'))).toBe(403)
    expect(desktopSessionHttpStatus(new Error('device mismatch'))).toBe(403)
    expect(desktopSessionHttpStatus(new Error('desktop session not found'))).toBe(404)
  })
})

describe('parsePublicDesktopSession', () => {
  it('unwraps apiSuccess envelopes and requires a sessionId', () => {
    expect(parsePublicDesktopSession({
      success: true,
      data: { sessionId: 'desk_1', status: 'queued', driver: 'agent', latestFrameUrl: null, screenWidth: 800, screenHeight: 600 },
    })).toEqual({
      sessionId: 'desk_1',
      conversationId: undefined,
      status: 'queued',
      driver: 'agent',
      latestFrameUrl: null,
      frameCount: undefined,
      screenWidth: 800,
      screenHeight: 600,
      sessionKind: 'desktop',
    })
    expect(parsePublicDesktopSession({ data: { status: 'running' } })).toBeNull()
    expect(parsePublicDesktopSession(null)).toBeNull()
  })
})
