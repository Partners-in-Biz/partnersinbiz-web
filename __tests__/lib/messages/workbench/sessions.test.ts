import {
  appendWorkbenchSessionControl,
  generateWorkbenchSessionId,
  isTerminalWorkbenchSessionStatus,
  parseWorkbenchSessionControl,
  publicWorkbenchSession,
  resolveWorkbenchSessionShell,
  sanitizeWorkbenchSessionCwd,
  sanitizeWorkbenchSessionDimensions,
  sanitizeWorkbenchSessionStdin,
  transitionWorkbenchSession,
  type WorkbenchSession,
} from '@/lib/messages/workbench/sessions'

function queuedSession(overrides: Partial<WorkbenchSession> = {}): WorkbenchSession {
  return {
    sessionId: 'wbs_a',
    conversationId: 'conversation-a',
    orgId: 'org-a',
    actorUserId: 'user-a',
    actorRole: 'client',
    deviceId: 'device-a',
    runtimeTargetId: 'runtime-a',
    credentialVersion: 3,
    workspaceId: 'workspace-a',
    mappingId: 'mapping-a',
    relativeFolder: 'projects/project-a',
    shell: 'zsh',
    cols: 120,
    rows: 40,
    status: 'queued',
    attempt: 0,
    encryptedCreateControl: { ciphertext: 'cipher', iv: 'iv', tag: 'tag' },
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    ttlExpiresAtMs: 100_000,
    ...overrides,
  }
}

describe('resolveWorkbenchSessionShell', () => {
  it('resolves zsh for macos and bash for everything else, never trusting client input', () => {
    expect(resolveWorkbenchSessionShell('macos')).toBe('zsh')
    expect(resolveWorkbenchSessionShell('linux')).toBe('bash')
    expect(resolveWorkbenchSessionShell('windows')).toBe('bash')
    expect(resolveWorkbenchSessionShell(undefined)).toBe('bash')
  })
})

describe('sanitizeWorkbenchSessionDimensions', () => {
  it('defaults to 120x40 when omitted', () => {
    expect(sanitizeWorkbenchSessionDimensions(undefined, undefined)).toEqual({ cols: 120, rows: 40 })
  })

  it('clamps into the 1..300 range', () => {
    expect(sanitizeWorkbenchSessionDimensions(0, 0)).toEqual({ cols: 1, rows: 1 })
    expect(sanitizeWorkbenchSessionDimensions(-5, 999_999)).toEqual({ cols: 1, rows: 300 })
    expect(sanitizeWorkbenchSessionDimensions(80, 24)).toEqual({ cols: 80, rows: 24 })
  })

  it('rejects non-numeric input', () => {
    expect(sanitizeWorkbenchSessionDimensions('80', 24)).toBeNull()
    expect(sanitizeWorkbenchSessionDimensions(80, 'x')).toBeNull()
    expect(sanitizeWorkbenchSessionDimensions(Number.NaN, 24)).toBeNull()
  })
})

describe('sanitizeWorkbenchSessionCwd', () => {
  it('defaults to the workspace root and normalizes safe relative paths', () => {
    expect(sanitizeWorkbenchSessionCwd(undefined)).toBe('.')
    expect(sanitizeWorkbenchSessionCwd('src//lib')).toBe('src/lib')
  })

  it.each(['../escape', '/etc', 'C:\\Windows', 42, null])('rejects unsafe cwd %j', (cwd) => {
    expect(sanitizeWorkbenchSessionCwd(cwd)).toBeNull()
  })
})

describe('sanitizeWorkbenchSessionStdin', () => {
  it('defaults mode to line and preserves raw control bytes other than NUL', () => {
    expect(sanitizeWorkbenchSessionStdin('ls\n', undefined)).toEqual({ data: 'ls\n', mode: 'line' })
    expect(sanitizeWorkbenchSessionStdin('\u0003', 'raw')).toEqual({ data: '\u0003', mode: 'raw' })
  })

  it('rejects empty data, null bytes, oversized payloads, and unknown modes', () => {
    expect(sanitizeWorkbenchSessionStdin('', undefined)).toBeNull()
    expect(sanitizeWorkbenchSessionStdin('a\u0000b', undefined)).toBeNull()
    expect(sanitizeWorkbenchSessionStdin('a'.repeat(8_001), undefined)).toBeNull()
    expect(sanitizeWorkbenchSessionStdin('ok', 'weird')).toBeNull()
    expect(sanitizeWorkbenchSessionStdin(42, undefined)).toBeNull()
  })

  it('accepts stdin right at the 8KB boundary', () => {
    expect(sanitizeWorkbenchSessionStdin('a'.repeat(8_000), 'line')).toEqual({ data: 'a'.repeat(8_000), mode: 'line' })
  })
})

describe('generateWorkbenchSessionId', () => {
  it('produces unique, prefixed ids', () => {
    const first = generateWorkbenchSessionId()
    const second = generateWorkbenchSessionId()
    expect(first).toMatch(/^wbs_/)
    expect(first).not.toBe(second)
  })
})

describe('parseWorkbenchSessionControl', () => {
  it.each([
    [{ kind: 'create', cols: 80, rows: 24, cwd: '.', shell: 'bash' }, { kind: 'create', cols: 80, rows: 24, cwd: '.', shell: 'bash' }],
    [{ kind: 'stdin', data: 'ls\n' }, { kind: 'stdin', data: 'ls\n', mode: 'line' }],
    [{ kind: 'resize', cols: 100, rows: 30 }, { kind: 'resize', cols: 100, rows: 30 }],
    [{ kind: 'kill' }, { kind: 'kill' }],
  ])('accepts typed control %j', (input, expected) => {
    expect(parseWorkbenchSessionControl(input)).toEqual(expected)
  })

  it.each([
    { kind: 'create', cols: 80, rows: 24, cwd: '.', shell: 'powershell' },
    { kind: 'create', cols: 80, rows: 24, cwd: '../escape', shell: 'bash' },
    { kind: 'stdin', data: '' },
    { kind: 'stdin', data: 'x\u0000y' },
    { kind: 'resize', cols: 'wide', rows: 30 },
    { kind: 'kill', extra: true },
    { kind: 'unknown' },
  ])('rejects unsafe or untyped control %j', (input) => {
    expect(() => parseWorkbenchSessionControl(input)).toThrow('workbench: invalid session control')
  })
})

describe('appendWorkbenchSessionControl', () => {
  it('caps the FIFO at 64 entries, dropping the oldest first', () => {
    let controls: ReturnType<typeof appendWorkbenchSessionControl> | undefined
    for (let seq = 0; seq < 70; seq += 1) {
      controls = appendWorkbenchSessionControl(controls, { seq, control: { kind: 'kill' }, actorUserId: 'user-a', enqueuedAtMs: seq })
    }
    expect(controls).toHaveLength(64)
    expect(controls![0].seq).toBe(6)
    expect(controls![63].seq).toBe(69)
  })
})

describe('isTerminalWorkbenchSessionStatus', () => {
  it('classifies terminal vs. non-terminal statuses', () => {
    expect(isTerminalWorkbenchSessionStatus('queued')).toBe(false)
    expect(isTerminalWorkbenchSessionStatus('claimed')).toBe(false)
    expect(isTerminalWorkbenchSessionStatus('running')).toBe(false)
    expect(isTerminalWorkbenchSessionStatus('exited')).toBe(true)
    expect(isTerminalWorkbenchSessionStatus('killed')).toBe(true)
    expect(isTerminalWorkbenchSessionStatus('expired')).toBe(true)
    expect(isTerminalWorkbenchSessionStatus('failed')).toBe(true)
  })
})

describe('publicWorkbenchSession', () => {
  it('never exposes encrypted payloads, credentials, or physical paths to the browser', () => {
    const view = publicWorkbenchSession(queuedSession({
      progressChunks: [{ seq: 0, stream: 'stdout', text: 'v20.0.0\n', atMs: 1_000 }],
      exitCode: 0,
    }))
    expect(view).toMatchObject({ sessionId: 'wbs_a', status: 'queued', cols: 120, rows: 40, shell: 'zsh', exitCode: 0 })
    expect(view.progress).toEqual([{ seq: 0, stream: 'stdout', text: 'v20.0.0\n', atMs: 1_000 }])
    expect(JSON.stringify(view)).not.toMatch(/encrypted|credential|relativeFolder|Users\//i)
  })
})

describe('workbench session queue transitions', () => {
  it('claims the create control, generating a lease and incrementing attempt', () => {
    const claimed = transitionWorkbenchSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    expect(claimed.status).toBe('claimed')
    expect(claimed.attempt).toBe(1)
    expect(claimed.leaseToken).toEqual(expect.any(String))
    expect(claimed.encryptedCreateControl).toBeNull()
    expect(claimed.leaseExpiresAtMs).toBe(92_000)
  })

  it('rejects claiming an already-claimed session or a device/credential mismatch', () => {
    const claimed = transitionWorkbenchSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    expect(() => transitionWorkbenchSession(claimed, {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 3_000, leaseMs: 90_000,
    })).toThrow('workbench: session already claimed')
    expect(() => transitionWorkbenchSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-b', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })).toThrow('workbench: device mismatch')
  })

  it('rejects claiming an expired session', () => {
    expect(() => transitionWorkbenchSession(queuedSession({ ttlExpiresAtMs: 1_500 }), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })).toThrow('workbench: session expired')
  })

  it('flips claimed -> running on the first progress call and renews the lease thereafter', () => {
    const claimed = transitionWorkbenchSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    const running = transitionWorkbenchSession(claimed, {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3, attempt: claimed.attempt, leaseToken: claimed.leaseToken!,
      nowMs: 5_000, leaseMs: 90_000,
    })
    expect(running.status).toBe('running')
    expect(running.leaseExpiresAtMs).toBe(95_000)

    const renewed = transitionWorkbenchSession(running, {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3, attempt: running.attempt, leaseToken: running.leaseToken!,
      nowMs: 10_000, leaseMs: 90_000,
    })
    expect(renewed.status).toBe('running')
    expect(renewed.leaseExpiresAtMs).toBe(100_000)
  })

  it('rejects progress with a stale lease or on an unclaimed session', () => {
    const claimed = transitionWorkbenchSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    expect(() => transitionWorkbenchSession(claimed, {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3, attempt: claimed.attempt, leaseToken: 'stale',
      nowMs: 5_000, leaseMs: 90_000,
    })).toThrow('workbench: lease mismatch')
    expect(() => transitionWorkbenchSession(queuedSession(), {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3, attempt: 0, leaseToken: 'none',
      nowMs: 5_000, leaseMs: 90_000,
    })).toThrow('workbench: session not claimed')
  })

  it('applies resize optimistically to a claimed/running session and rejects it once terminal', () => {
    const resized = transitionWorkbenchSession(queuedSession({ status: 'running' }), { type: 'resize', cols: 200, rows: 60, nowMs: 3_000 })
    expect(resized).toMatchObject({ cols: 200, rows: 60 })
    expect(() => transitionWorkbenchSession(queuedSession({ status: 'exited' }), { type: 'resize', cols: 200, rows: 60, nowMs: 3_000 }))
      .toThrow('workbench: session already final')
  })

  it('kills a queued session directly (no pty exists yet) but refuses to kill an already-claimed one this way', () => {
    const killed = transitionWorkbenchSession(queuedSession(), { type: 'killQueued', nowMs: 4_000 })
    expect(killed).toMatchObject({ status: 'killed', encryptedCreateControl: null })
    expect(() => transitionWorkbenchSession(queuedSession({ status: 'running' }), { type: 'killQueued', nowMs: 4_000 }))
      .toThrow('workbench: session already claimed')
  })

  it('completes a running session and rejects completion with a stale lease', () => {
    const claimed = transitionWorkbenchSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    const completed = transitionWorkbenchSession(claimed, {
      type: 'complete', deviceId: 'device-a', credentialVersion: 3, attempt: claimed.attempt, leaseToken: claimed.leaseToken!,
      outcome: 'exited', nowMs: 9_000,
    })
    expect(completed).toMatchObject({ status: 'exited', encryptedCreateControl: null, encryptedControls: null })

    expect(() => transitionWorkbenchSession(claimed, {
      type: 'complete', deviceId: 'device-a', credentialVersion: 3, attempt: claimed.attempt, leaseToken: 'stale-lease',
      outcome: 'exited', nowMs: 9_000,
    })).toThrow('workbench: lease mismatch')
  })

  it('is idempotent when re-completing with the same outcome', () => {
    const exited = queuedSession({ status: 'exited' })
    expect(transitionWorkbenchSession(exited, {
      type: 'complete', deviceId: 'device-a', credentialVersion: 3, attempt: 1, leaseToken: 'irrelevant', outcome: 'exited', nowMs: 9_000,
    })).toBe(exited)
  })

  it('expires a claimed session once and leaves a terminal session untouched', () => {
    const claimed = transitionWorkbenchSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    const expired = transitionWorkbenchSession(claimed, { type: 'expire', nowMs: 200_000 })
    expect(expired).toMatchObject({ status: 'expired', encryptedCreateControl: null, encryptedControls: null })
    const exited = queuedSession({ status: 'exited' })
    expect(transitionWorkbenchSession(exited, { type: 'expire', nowMs: 200_000 })).toBe(exited)
  })
})
