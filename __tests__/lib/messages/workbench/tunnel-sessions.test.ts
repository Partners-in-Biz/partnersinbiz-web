import {
  appendWorkbenchTunnelControl,
  appendWorkbenchTunnelProgressChunk,
  decryptWorkbenchTunnelValue,
  encryptWorkbenchTunnelValue,
  generateWorkbenchTunnelSessionId,
  isTerminalWorkbenchTunnelStatus,
  parseWorkbenchTunnelControl,
  parseWorkbenchTunnelProgressChunk,
  publicWorkbenchTunnelSession,
  sanitizeWorkbenchTunnelPort,
  transitionWorkbenchTunnelSession,
  WORKBENCH_TUNNEL_BIND_HOST,
  WORKBENCH_TUNNEL_DEFAULT_PROVIDER,
  type WorkbenchTunnelSession,
} from '@/lib/messages/workbench/tunnel-sessions'

function awaitingApprovalSession(overrides: Partial<WorkbenchTunnelSession> = {}): WorkbenchTunnelSession {
  return {
    sessionId: 'wbt_a',
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
    port: 5173,
    bindHost: WORKBENCH_TUNNEL_BIND_HOST,
    provider: WORKBENCH_TUNNEL_DEFAULT_PROVIDER,
    status: 'awaiting_approval',
    attempt: 0,
    encryptedCreateControl: { ciphertext: 'cipher', iv: 'iv', tag: 'tag' },
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    ttlExpiresAtMs: 100_000,
    ...overrides,
  }
}

function queuedSession(overrides: Partial<WorkbenchTunnelSession> = {}): WorkbenchTunnelSession {
  return awaitingApprovalSession({ status: 'queued', approvedByUserId: 'user-a', approvedAtMs: 1_500, ...overrides })
}

describe('sanitizeWorkbenchTunnelPort', () => {
  it('accepts integers in the 1024..65535 range', () => {
    expect(sanitizeWorkbenchTunnelPort(1024)).toBe(1024)
    expect(sanitizeWorkbenchTunnelPort(65535)).toBe(65535)
    expect(sanitizeWorkbenchTunnelPort(5173)).toBe(5173)
  })

  it.each([1023, 65536, -1, 0, 3.5, Number.NaN, '3000', null, undefined])('rejects out-of-range or non-integer port %j', (port) => {
    expect(sanitizeWorkbenchTunnelPort(port)).toBeNull()
  })
})

describe('generateWorkbenchTunnelSessionId', () => {
  it('produces unique, prefixed ids', () => {
    const first = generateWorkbenchTunnelSessionId()
    const second = generateWorkbenchTunnelSessionId()
    expect(first).toMatch(/^wbt_/)
    expect(first).not.toBe(second)
  })
})

describe('parseWorkbenchTunnelControl', () => {
  it('accepts a well-formed create control', () => {
    expect(parseWorkbenchTunnelControl({ kind: 'create', port: 5173, bindHost: '127.0.0.1', provider: 'cloudflared' }))
      .toEqual({ kind: 'create', port: 5173, bindHost: '127.0.0.1', provider: 'cloudflared' })
  })

  it('accepts a kill control', () => {
    expect(parseWorkbenchTunnelControl({ kind: 'kill' })).toEqual({ kind: 'kill' })
  })

  it.each([
    { kind: 'create', port: 80, bindHost: '127.0.0.1', provider: 'cloudflared' },
    { kind: 'create', port: 5173, bindHost: '0.0.0.0', provider: 'cloudflared' },
    { kind: 'create', port: 5173, bindHost: '127.0.0.1', provider: 'ngrok' },
    { kind: 'create', port: 5173, bindHost: '127.0.0.1', provider: 'cloudflared', extra: true },
    { kind: 'kill', extra: true },
    { kind: 'unknown' },
    null,
    'kill',
  ])('rejects unsafe or malformed control %j', (input) => {
    expect(() => parseWorkbenchTunnelControl(input)).toThrow('workbench: invalid tunnel control')
  })
})

describe('parseWorkbenchTunnelProgressChunk', () => {
  it('accepts a status/stderr text chunk', () => {
    expect(parseWorkbenchTunnelProgressChunk({ seq: 0, stream: 'status', text: 'starting tunnel…', atMs: 1_000 }))
      .toEqual({ seq: 0, stream: 'status', text: 'starting tunnel…', atMs: 1_000 })
  })

  it('accepts a tunnel chunk carrying the resolved public/local URLs', () => {
    expect(parseWorkbenchTunnelProgressChunk({
      seq: 1, stream: 'tunnel', publicUrl: 'https://abcd.trycloudflare.com', localUrl: 'http://127.0.0.1:5173', provider: 'cloudflared', atMs: 2_000,
    })).toEqual({
      seq: 1, stream: 'tunnel', publicUrl: 'https://abcd.trycloudflare.com', localUrl: 'http://127.0.0.1:5173', provider: 'cloudflared', atMs: 2_000,
    })
  })

  it('truncates oversized text to the byte cap', () => {
    const chunk = parseWorkbenchTunnelProgressChunk({ seq: 0, stream: 'stderr', text: 'a'.repeat(3_000), atMs: 1_000 })
    expect(Buffer.byteLength(chunk.text!, 'utf8')).toBe(2_000)
  })

  it.each([
    { seq: -1, stream: 'status', atMs: 1_000 },
    { seq: 0, stream: 'bogus', atMs: 1_000 },
    { seq: 0, stream: 'status', atMs: -1 },
    { seq: 0, stream: 'tunnel', publicUrl: 'http://not-https.example.com', atMs: 1_000 },
    { seq: 0, stream: 'tunnel', localUrl: 'http://10.0.0.5:5173', atMs: 1_000 },
    { seq: 0, stream: 'status', provider: 'ngrok', atMs: 1_000 },
    null,
  ])('rejects malformed chunk %j', (input) => {
    expect(() => parseWorkbenchTunnelProgressChunk(input)).toThrow('workbench: invalid tunnel progress chunk')
  })
})

describe('appendWorkbenchTunnelProgressChunk', () => {
  it('caps the ring buffer at 32 entries, dropping the oldest first', () => {
    let chunks: ReturnType<typeof appendWorkbenchTunnelProgressChunk> | undefined
    for (let seq = 0; seq < 40; seq += 1) {
      chunks = appendWorkbenchTunnelProgressChunk(chunks, { seq, stream: 'status', atMs: seq })
    }
    expect(chunks).toHaveLength(32)
    expect(chunks![0].seq).toBe(8)
    expect(chunks![31].seq).toBe(39)
  })
})

describe('appendWorkbenchTunnelControl', () => {
  it('caps the FIFO at 8 entries, dropping the oldest first', () => {
    let controls: ReturnType<typeof appendWorkbenchTunnelControl> | undefined
    for (let seq = 0; seq < 10; seq += 1) {
      controls = appendWorkbenchTunnelControl(controls, { seq, control: { kind: 'kill' }, actorUserId: 'user-a', enqueuedAtMs: seq })
    }
    expect(controls).toHaveLength(8)
    expect(controls![0].seq).toBe(2)
    expect(controls![7].seq).toBe(9)
  })
})

describe('encryptWorkbenchTunnelValue / decryptWorkbenchTunnelValue', () => {
  beforeEach(() => { process.env.SOCIAL_TOKEN_MASTER_KEY = 'tunnel-sessions-test-key' })

  it('round-trips a value scoped to (deviceId, sessionId, purpose)', () => {
    const value = { kind: 'create', port: 5173, bindHost: '127.0.0.1', provider: 'cloudflared' }
    const encrypted = encryptWorkbenchTunnelValue(value, 'device-a', 'wbt_a', 'create')
    expect(decryptWorkbenchTunnelValue(encrypted, 'device-a', 'wbt_a', 'create')).toEqual(value)
  })

  it('fails to decrypt with the wrong purpose (distinct derived key per field)', () => {
    const encrypted = encryptWorkbenchTunnelValue({ kind: 'kill' }, 'device-a', 'wbt_a', 'control')
    expect(() => decryptWorkbenchTunnelValue(encrypted, 'device-a', 'wbt_a', 'create')).toThrow()
  })

  it('fails to decrypt with the wrong deviceId or sessionId', () => {
    const encrypted = encryptWorkbenchTunnelValue({ kind: 'kill' }, 'device-a', 'wbt_a', 'control')
    expect(() => decryptWorkbenchTunnelValue(encrypted, 'device-b', 'wbt_a', 'control')).toThrow()
    expect(() => decryptWorkbenchTunnelValue(encrypted, 'device-a', 'wbt_b', 'control')).toThrow()
  })
})

describe('isTerminalWorkbenchTunnelStatus', () => {
  it('classifies terminal vs. non-terminal statuses', () => {
    expect(isTerminalWorkbenchTunnelStatus('awaiting_approval')).toBe(false)
    expect(isTerminalWorkbenchTunnelStatus('queued')).toBe(false)
    expect(isTerminalWorkbenchTunnelStatus('claimed')).toBe(false)
    expect(isTerminalWorkbenchTunnelStatus('running')).toBe(false)
    expect(isTerminalWorkbenchTunnelStatus('exited')).toBe(true)
    expect(isTerminalWorkbenchTunnelStatus('killed')).toBe(true)
    expect(isTerminalWorkbenchTunnelStatus('expired')).toBe(true)
    expect(isTerminalWorkbenchTunnelStatus('failed')).toBe(true)
  })
})

describe('publicWorkbenchTunnelSession', () => {
  it('never exposes encrypted payloads, credentials, or physical paths to the browser', () => {
    const view = publicWorkbenchTunnelSession(queuedSession({
      progressChunks: [{ seq: 0, stream: 'tunnel', publicUrl: 'https://abcd.trycloudflare.com', atMs: 1_000 }],
      publicUrl: 'https://abcd.trycloudflare.com',
    }))
    expect(view).toMatchObject({ sessionId: 'wbt_a', status: 'queued', port: 5173, provider: 'cloudflared', publicUrl: 'https://abcd.trycloudflare.com' })
    expect(view.approvalRequired).toBe(false)
    expect(JSON.stringify(view)).not.toMatch(/encrypted|credential|relativeFolder|Users\//i)
  })

  it('flags approvalRequired only while awaiting_approval', () => {
    expect(publicWorkbenchTunnelSession(awaitingApprovalSession()).approvalRequired).toBe(true)
    expect(publicWorkbenchTunnelSession(queuedSession()).approvalRequired).toBe(false)
  })
})

describe('workbench tunnel session transitions', () => {
  it('always starts awaiting_approval and approve flips it to queued', () => {
    const approved = transitionWorkbenchTunnelSession(awaitingApprovalSession(), {
      type: 'approve', approverUserId: 'user-a', nowMs: 2_000,
    })
    expect(approved).toMatchObject({ status: 'queued', approvedByUserId: 'user-a', approvedAtMs: 2_000 })
  })

  it('rejects approval by a different user, of an already-queued tunnel, or once expired', () => {
    expect(() => transitionWorkbenchTunnelSession(awaitingApprovalSession(), {
      type: 'approve', approverUserId: 'user-b', nowMs: 2_000,
    })).toThrow('workbench: tunnel approval owner mismatch')
    expect(() => transitionWorkbenchTunnelSession(queuedSession(), {
      type: 'approve', approverUserId: 'user-a', nowMs: 2_000,
    })).toThrow('workbench: tunnel is not awaiting approval')
    expect(() => transitionWorkbenchTunnelSession(awaitingApprovalSession({ ttlExpiresAtMs: 1_500 }), {
      type: 'approve', approverUserId: 'user-a', nowMs: 2_000,
    })).toThrow('workbench: tunnel expired')
  })

  it('claims the create control, generating a lease and incrementing attempt', () => {
    const claimed = transitionWorkbenchTunnelSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    expect(claimed.status).toBe('claimed')
    expect(claimed.attempt).toBe(1)
    expect(claimed.leaseToken).toEqual(expect.any(String))
    expect(claimed.encryptedCreateControl).toBeNull()
    expect(claimed.leaseExpiresAtMs).toBe(92_000)
  })

  it('rejects claiming an unqueued tunnel or a device/credential mismatch', () => {
    expect(() => transitionWorkbenchTunnelSession(awaitingApprovalSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })).toThrow('workbench: tunnel already claimed')
    expect(() => transitionWorkbenchTunnelSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-b', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })).toThrow('workbench: device mismatch')
    expect(() => transitionWorkbenchTunnelSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 9, nowMs: 2_000, leaseMs: 90_000,
    })).toThrow('workbench: credential mismatch')
  })

  it('flips claimed -> running on the first progress call, optionally carrying the resolved publicUrl, and renews the lease thereafter', () => {
    const claimed = transitionWorkbenchTunnelSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    const running = transitionWorkbenchTunnelSession(claimed, {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3, attempt: claimed.attempt, leaseToken: claimed.leaseToken!,
      nowMs: 5_000, leaseMs: 90_000, publicUrl: 'https://abcd.trycloudflare.com',
    })
    expect(running.status).toBe('running')
    expect(running.publicUrl).toBe('https://abcd.trycloudflare.com')
    expect(running.leaseExpiresAtMs).toBe(95_000)

    const renewed = transitionWorkbenchTunnelSession(running, {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3, attempt: running.attempt, leaseToken: running.leaseToken!,
      nowMs: 10_000, leaseMs: 90_000,
    })
    expect(renewed.status).toBe('running')
    expect(renewed.publicUrl).toBe('https://abcd.trycloudflare.com')
    expect(renewed.leaseExpiresAtMs).toBe(100_000)
  })

  it('rejects progress with a stale lease, on an unclaimed tunnel, or once expired', () => {
    const claimed = transitionWorkbenchTunnelSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    expect(() => transitionWorkbenchTunnelSession(claimed, {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3, attempt: claimed.attempt, leaseToken: 'stale',
      nowMs: 5_000, leaseMs: 90_000,
    })).toThrow('workbench: lease mismatch')
    expect(() => transitionWorkbenchTunnelSession(queuedSession(), {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3, attempt: 0, leaseToken: 'none',
      nowMs: 5_000, leaseMs: 90_000,
    })).toThrow('workbench: tunnel not claimed')
    expect(() => transitionWorkbenchTunnelSession(claimed, {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3, attempt: claimed.attempt, leaseToken: claimed.leaseToken!,
      nowMs: 200_000, leaseMs: 90_000,
    })).toThrow('workbench: lease expired')
  })

  it('kills an awaiting_approval or queued tunnel directly (no process exists yet) but refuses to kill an already-claimed one this way', () => {
    const killed = transitionWorkbenchTunnelSession(awaitingApprovalSession(), { type: 'killQueued', nowMs: 4_000 })
    expect(killed).toMatchObject({ status: 'killed', encryptedCreateControl: null })
    const killedQueued = transitionWorkbenchTunnelSession(queuedSession(), { type: 'killQueued', nowMs: 4_000 })
    expect(killedQueued).toMatchObject({ status: 'killed' })
    expect(() => transitionWorkbenchTunnelSession(queuedSession({ status: 'running' }), { type: 'killQueued', nowMs: 4_000 }))
      .toThrow('workbench: tunnel already claimed')
  })

  it('completes a running tunnel and rejects completion with a stale lease', () => {
    const claimed = transitionWorkbenchTunnelSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    const completed = transitionWorkbenchTunnelSession(claimed, {
      type: 'complete', deviceId: 'device-a', credentialVersion: 3, attempt: claimed.attempt, leaseToken: claimed.leaseToken!,
      outcome: 'exited', nowMs: 9_000,
    })
    expect(completed).toMatchObject({ status: 'exited', encryptedCreateControl: null, encryptedControls: null })

    expect(() => transitionWorkbenchTunnelSession(claimed, {
      type: 'complete', deviceId: 'device-a', credentialVersion: 3, attempt: claimed.attempt, leaseToken: 'stale-lease',
      outcome: 'exited', nowMs: 9_000,
    })).toThrow('workbench: lease mismatch')
  })

  it('is idempotent when re-completing with the same outcome', () => {
    const exited = queuedSession({ status: 'exited' })
    expect(transitionWorkbenchTunnelSession(exited, {
      type: 'complete', deviceId: 'device-a', credentialVersion: 3, attempt: 1, leaseToken: 'irrelevant', outcome: 'exited', nowMs: 9_000,
    })).toBe(exited)
  })

  it('expires a claimed tunnel once and leaves a terminal tunnel untouched', () => {
    const claimed = transitionWorkbenchTunnelSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    const expired = transitionWorkbenchTunnelSession(claimed, { type: 'expire', nowMs: 200_000 })
    expect(expired).toMatchObject({ status: 'expired', encryptedCreateControl: null, encryptedControls: null })
    const exited = queuedSession({ status: 'exited' })
    expect(transitionWorkbenchTunnelSession(exited, { type: 'expire', nowMs: 200_000 })).toBe(exited)
  })
})
