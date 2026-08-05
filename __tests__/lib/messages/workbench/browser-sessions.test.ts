import {
  appendWorkbenchBrowserProgressChunk,
  appendWorkbenchBrowserSessionControl,
  generateWorkbenchBrowserSessionId,
  isPrivateWorkbenchBrowserUrl,
  isTerminalWorkbenchBrowserSessionStatus,
  isWorkbenchBrowserDrivingControl,
  parseWorkbenchBrowserProgressChunk,
  parseWorkbenchBrowserSessionControl,
  publicWorkbenchBrowserSession,
  sanitizeWorkbenchBrowserClickRef,
  sanitizeWorkbenchBrowserDialog,
  sanitizeWorkbenchBrowserFollowIntervalMs,
  sanitizeWorkbenchBrowserKey,
  sanitizeWorkbenchBrowserMouseButton,
  sanitizeWorkbenchBrowserPoint,
  sanitizeWorkbenchBrowserScrollDeltas,
  sanitizeWorkbenchBrowserStartUrl,
  sanitizeWorkbenchBrowserTypeText,
  sanitizeWorkbenchBrowserUrl,
  sanitizeWorkbenchBrowserViewport,
  transitionWorkbenchBrowserSession,
  workbenchBrowserActorKindFromHeader,
  WORKBENCH_BROWSER_ALLOWED_KEYS,
  type WorkbenchBrowserSession,
} from '@/lib/messages/workbench/browser-sessions'

function awaitingApprovalSession(overrides: Partial<WorkbenchBrowserSession> = {}): WorkbenchBrowserSession {
  return {
    sessionId: 'wbbs_a',
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
    startUrl: null,
    viewport: { width: 1280, height: 720 },
    initiator: 'user',
    driver: 'idle',
    allowPrivateNetwork: true,
    status: 'awaiting_approval',
    attempt: 0,
    encryptedCreateControl: { ciphertext: 'cipher', iv: 'iv', tag: 'tag' },
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    ttlExpiresAtMs: 100_000,
    ...overrides,
  }
}

function queuedSession(overrides: Partial<WorkbenchBrowserSession> = {}): WorkbenchBrowserSession {
  return awaitingApprovalSession({ status: 'queued', approvedByUserId: 'user-a', approvedAtMs: 1_500, ...overrides })
}

describe('sanitizeWorkbenchBrowserUrl', () => {
  it('accepts http/https URLs including localhost, 127.0.0.1, and *.localhost', () => {
    expect(sanitizeWorkbenchBrowserUrl('https://example.com/path')).toBe('https://example.com/path')
    expect(sanitizeWorkbenchBrowserUrl('http://localhost:3000')).toBe('http://localhost:3000/')
    expect(sanitizeWorkbenchBrowserUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/')
    expect(sanitizeWorkbenchBrowserUrl('http://myapp.localhost')).toBe('http://myapp.localhost/')
  })

  it('rejects file://, javascript:, credentialed URLs, and non-string/empty/oversized input', () => {
    expect(sanitizeWorkbenchBrowserUrl('file:///etc/passwd')).toBeNull()
    expect(sanitizeWorkbenchBrowserUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeWorkbenchBrowserUrl('https://user:pass@example.com')).toBeNull()
    expect(sanitizeWorkbenchBrowserUrl('')).toBeNull()
    expect(sanitizeWorkbenchBrowserUrl(42)).toBeNull()
    expect(sanitizeWorkbenchBrowserUrl(`https://example.com/${'a'.repeat(2_048)}`)).toBeNull()
  })
})

describe('sanitizeWorkbenchBrowserStartUrl', () => {
  it('allows omitted/null (blank tab) and validates a provided URL', () => {
    expect(sanitizeWorkbenchBrowserStartUrl(undefined)).toEqual({ ok: true, url: null })
    expect(sanitizeWorkbenchBrowserStartUrl(null)).toEqual({ ok: true, url: null })
    expect(sanitizeWorkbenchBrowserStartUrl('https://example.com')).toEqual({ ok: true, url: 'https://example.com/' })
    expect(sanitizeWorkbenchBrowserStartUrl('javascript:alert(1)')).toEqual({ ok: false })
  })
})

describe('sanitizeWorkbenchBrowserViewport', () => {
  it('defaults to 1280x720 when omitted', () => {
    expect(sanitizeWorkbenchBrowserViewport(undefined, undefined)).toEqual({ width: 1280, height: 720 })
  })

  it('clamps into 320-1920 x 240-1200', () => {
    expect(sanitizeWorkbenchBrowserViewport(0, 0)).toEqual({ width: 320, height: 240 })
    expect(sanitizeWorkbenchBrowserViewport(5_000, 5_000)).toEqual({ width: 1920, height: 1200 })
    expect(sanitizeWorkbenchBrowserViewport(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('rejects non-numeric input', () => {
    expect(sanitizeWorkbenchBrowserViewport('800', 600)).toBeNull()
    expect(sanitizeWorkbenchBrowserViewport(800, Number.NaN)).toBeNull()
  })
})

describe('generateWorkbenchBrowserSessionId', () => {
  it('produces unique, prefixed ids', () => {
    const first = generateWorkbenchBrowserSessionId()
    const second = generateWorkbenchBrowserSessionId()
    expect(first).toMatch(/^wbbs_/)
    expect(first).not.toBe(second)
  })
})

describe('parseWorkbenchBrowserSessionControl', () => {
  it.each([
    [{ kind: 'create', startUrl: 'https://example.com', viewport: { width: 800, height: 600 } }, { kind: 'create', startUrl: 'https://example.com/', viewport: { width: 800, height: 600 } }],
    [{ kind: 'create', startUrl: null, viewport: { width: 1280, height: 720 } }, { kind: 'create', startUrl: null, viewport: { width: 1280, height: 720 } }],
    [{ kind: 'navigate', url: 'https://example.com/next' }, { kind: 'navigate', url: 'https://example.com/next' }],
    [{ kind: 'capture' }, { kind: 'capture' }],
    [{ kind: 'kill' }, { kind: 'kill' }],
  ])('accepts typed control %j', (input, expected) => {
    expect(parseWorkbenchBrowserSessionControl(input)).toEqual(expected)
  })

  it.each([
    [{ kind: 'click', x: 10, y: 20 }, { kind: 'click', x: 10, y: 20, button: 'left' }],
    [{ kind: 'click', x: 10.7, y: 20.9, button: 'right' }, { kind: 'click', x: 10, y: 20, button: 'right' }],
    [{ kind: 'click', x: 0, y: 0, button: 'middle' }, { kind: 'click', x: 0, y: 0, button: 'middle' }],
    [{ kind: 'type', text: 'hello@example.com' }, { kind: 'type', text: 'hello@example.com' }],
    [{ kind: 'type', text: 'line one\nline two\ttabbed' }, { kind: 'type', text: 'line one\nline two\ttabbed' }],
    [{ kind: 'press', key: 'Enter' }, { kind: 'press', key: 'Enter' }],
    [{ kind: 'press', key: 'ArrowDown' }, { kind: 'press', key: 'ArrowDown' }],
    [{ kind: 'scroll', x: 5, y: 6, deltaY: 400 }, { kind: 'scroll', x: 5, y: 6, deltaX: 0, deltaY: 400 }],
    [{ kind: 'scroll', x: 5, y: 6, deltaX: -120, deltaY: -400 }, { kind: 'scroll', x: 5, y: 6, deltaX: -120, deltaY: -400 }],
    [{ kind: 'follow_start' }, { kind: 'follow_start', intervalMs: 1_000 }],
    [{ kind: 'follow_start', intervalMs: 2_500 }, { kind: 'follow_start', intervalMs: 2_500 }],
    [{ kind: 'follow_start', intervalMs: 10 }, { kind: 'follow_start', intervalMs: 500 }],
    [{ kind: 'follow_start', intervalMs: 60_000 }, { kind: 'follow_start', intervalMs: 5_000 }],
    [{ kind: 'follow_stop' }, { kind: 'follow_stop' }],
    [{ kind: 'snapshot' }, { kind: 'snapshot' }],
    [{ kind: 'console' }, { kind: 'console' }],
    [{ kind: 'dialog', accept: true }, { kind: 'dialog', accept: true }],
    [{ kind: 'dialog', accept: false, promptText: 'my answer' }, { kind: 'dialog', accept: false, promptText: 'my answer' }],
    [{ kind: 'click_ref', ref: '@e3' }, { kind: 'click_ref', ref: '@e3' }],
    [{ kind: 'click_ref', ref: 'e3' }, { kind: 'click_ref', ref: '@e3' }],
  ])('accepts Phase 5 interaction/follow control %j, resolving optional fields to defaults', (input, expected) => {
    expect(parseWorkbenchBrowserSessionControl(input)).toEqual(expected)
  })

  it.each([
    { kind: 'create', startUrl: 'javascript:alert(1)', viewport: { width: 800, height: 600 } },
    { kind: 'create', startUrl: null, viewport: { width: 800 } },
    { kind: 'navigate', url: 'file:///etc/passwd' },
    { kind: 'navigate' },
    { kind: 'capture', extra: true },
    { kind: 'kill', extra: true },
    { kind: 'unknown' },
    'not-an-object',
  ])('rejects unsafe or untyped control %j', (input) => {
    expect(() => parseWorkbenchBrowserSessionControl(input)).toThrow('workbench: invalid browser session control')
  })

  it.each([
    { kind: 'click', x: -1, y: 10 },
    { kind: 'click', x: 1_921, y: 10 },
    { kind: 'click', x: 10, y: 1_201 },
    { kind: 'click', x: Number.NaN, y: 10 },
    { kind: 'click', x: '10', y: 10 },
    { kind: 'click', x: 10, y: 10, button: 'back' },
    { kind: 'click', x: 10, y: 10, selector: 'button' },
    { kind: 'type', text: '' },
    { kind: 'type', text: 'x'.repeat(2_001) },
    { kind: 'type', text: 'red \u001b[31mtext' },
    { kind: 'type', text: 42 },
    { kind: 'press', key: 'a' },
    { kind: 'press', key: 'F12' },
    { kind: 'press', key: 'Meta+Q' },
    { kind: 'press' },
    { kind: 'scroll', x: 5, y: 6 },
    { kind: 'scroll', x: 5, y: 6, deltaY: Number.POSITIVE_INFINITY },
    { kind: 'scroll', x: 5, y: 6, deltaY: 100_001 },
    { kind: 'scroll', x: 5, y: 6, deltaY: 100, deltaZ: 1 },
    { kind: 'follow_start', intervalMs: 'fast' },
    { kind: 'follow_start', intervalMs: 1_000, extra: true },
    { kind: 'follow_stop', extra: true },
    { kind: 'dialog' },
    { kind: 'dialog', accept: 'yes' },
    { kind: 'dialog', accept: 1 },
    { kind: 'dialog', accept: true, promptText: 42 },
    { kind: 'dialog', accept: true, promptText: 'x'.repeat(1_001) },
    { kind: 'dialog', accept: true, extra: true },
    { kind: 'click_ref' },
    { kind: 'click_ref', ref: 'a.b' },
    { kind: 'click_ref', ref: 'a b' },
    { kind: 'click_ref', ref: '' },
    { kind: 'snapshot', extra: true },
    { kind: 'console', extra: true },
  ])('rejects out-of-range or unsafe interaction control %j', (input) => {
    expect(() => parseWorkbenchBrowserSessionControl(input)).toThrow('workbench: invalid browser session control')
  })
})

describe('interaction sanitizers', () => {
  it('validates viewport points, rejecting out-of-range coordinates rather than clamping them', () => {
    expect(sanitizeWorkbenchBrowserPoint(640, 360)).toEqual({ x: 640, y: 360 })
    expect(sanitizeWorkbenchBrowserPoint(1_920, 1_200)).toEqual({ x: 1_920, y: 1_200 })
    expect(sanitizeWorkbenchBrowserPoint(12.9, 7.1)).toEqual({ x: 12, y: 7 })
    expect(sanitizeWorkbenchBrowserPoint(1_921, 360)).toBeNull()
    expect(sanitizeWorkbenchBrowserPoint(-1, 360)).toBeNull()
    expect(sanitizeWorkbenchBrowserPoint(640, undefined)).toBeNull()
  })

  it('defaults an omitted mouse button to left', () => {
    expect(sanitizeWorkbenchBrowserMouseButton(undefined)).toBe('left')
    expect(sanitizeWorkbenchBrowserMouseButton('middle')).toBe('middle')
    expect(sanitizeWorkbenchBrowserMouseButton('back')).toBeNull()
  })

  it('requires deltaY and defaults deltaX to 0', () => {
    expect(sanitizeWorkbenchBrowserScrollDeltas(undefined, 400)).toEqual({ deltaX: 0, deltaY: 400 })
    expect(sanitizeWorkbenchBrowserScrollDeltas(-40, -400)).toEqual({ deltaX: -40, deltaY: -400 })
    expect(sanitizeWorkbenchBrowserScrollDeltas(0, undefined)).toBeNull()
    expect(sanitizeWorkbenchBrowserScrollDeltas(0, 100_001)).toBeNull()
  })

  it('keeps tab/newline in typed text but rejects other control characters', () => {
    expect(sanitizeWorkbenchBrowserTypeText('a\tb\nc')).toBe('a\tb\nc')
    expect(sanitizeWorkbenchBrowserTypeText('a\u0007b')).toBeNull()
    expect(sanitizeWorkbenchBrowserTypeText('')).toBeNull()
  })

  it('allowlists keys and clamps the follow interval to 500-5000ms', () => {
    for (const key of WORKBENCH_BROWSER_ALLOWED_KEYS) expect(sanitizeWorkbenchBrowserKey(key)).toBe(key)
    expect(sanitizeWorkbenchBrowserKey('Control')).toBeNull()
    expect(sanitizeWorkbenchBrowserFollowIntervalMs(undefined)).toBe(1_000)
    expect(sanitizeWorkbenchBrowserFollowIntervalMs(499)).toBe(500)
    expect(sanitizeWorkbenchBrowserFollowIntervalMs(5_001)).toBe(5_000)
    expect(sanitizeWorkbenchBrowserFollowIntervalMs('1000')).toBeNull()
  })
})

describe('sanitizeWorkbenchBrowserDialog', () => {
  it('accepts a boolean accept, with or without promptText', () => {
    expect(sanitizeWorkbenchBrowserDialog({ accept: true })).toEqual({ accept: true })
    expect(sanitizeWorkbenchBrowserDialog({ accept: false })).toEqual({ accept: false })
    expect(sanitizeWorkbenchBrowserDialog({ accept: false, promptText: 'my answer' })).toEqual({ accept: false, promptText: 'my answer' })
  })

  it('rejects non-object input and non-boolean accept', () => {
    expect(sanitizeWorkbenchBrowserDialog(null)).toBeNull()
    expect(sanitizeWorkbenchBrowserDialog('accept')).toBeNull()
    expect(sanitizeWorkbenchBrowserDialog([])).toBeNull()
    expect(sanitizeWorkbenchBrowserDialog({ accept: 'yes' })).toBeNull()
    expect(sanitizeWorkbenchBrowserDialog({ accept: 1 })).toBeNull()
    expect(sanitizeWorkbenchBrowserDialog({})).toBeNull()
  })

  it('rejects oversized or control-character promptText', () => {
    expect(sanitizeWorkbenchBrowserDialog({ accept: true, promptText: 'x'.repeat(1_001) })).toBeNull()
    expect(sanitizeWorkbenchBrowserDialog({ accept: true, promptText: 'yes\u0007bell' })).toBeNull()
    expect(sanitizeWorkbenchBrowserDialog({ accept: true, promptText: 'red \u001b[31mtext' })).toBeNull()
    expect(sanitizeWorkbenchBrowserDialog({ accept: true, promptText: 42 })).toBeNull()
  })
})

describe('sanitizeWorkbenchBrowserClickRef', () => {
  it('normalizes a bare ref to @-prefixed and keeps an already-prefixed one', () => {
    expect(sanitizeWorkbenchBrowserClickRef('e12')).toBe('@e12')
    expect(sanitizeWorkbenchBrowserClickRef('@e12')).toBe('@e12')
    expect(sanitizeWorkbenchBrowserClickRef('A1_b-c')).toBe('@A1_b-c')
  })

  it('rejects refs with slashes, dots, spaces, empty, oversized, or non-string input', () => {
    expect(sanitizeWorkbenchBrowserClickRef('')).toBeNull()
    expect(sanitizeWorkbenchBrowserClickRef('a.b')).toBeNull()
    expect(sanitizeWorkbenchBrowserClickRef('a/b')).toBeNull()
    expect(sanitizeWorkbenchBrowserClickRef('a b')).toBeNull()
    expect(sanitizeWorkbenchBrowserClickRef('@')).toBeNull()
    expect(sanitizeWorkbenchBrowserClickRef('a@b')).toBeNull()
    expect(sanitizeWorkbenchBrowserClickRef('x'.repeat(33))).toBeNull()
    expect(sanitizeWorkbenchBrowserClickRef('x'.repeat(32))).toBe('@' + 'x'.repeat(32))
    expect(sanitizeWorkbenchBrowserClickRef(42)).toBeNull()
  })
})

describe('isPrivateWorkbenchBrowserUrl', () => {
  it('treats localhost, .localhost, .local, loopback, and unspecified addresses as private', () => {
    expect(isPrivateWorkbenchBrowserUrl('http://localhost:3000')).toBe(true)
    expect(isPrivateWorkbenchBrowserUrl('http://myapp.localhost')).toBe(true)
    expect(isPrivateWorkbenchBrowserUrl('http://printer.local')).toBe(true)
    expect(isPrivateWorkbenchBrowserUrl('http://127.0.0.1:8080')).toBe(true)
    expect(isPrivateWorkbenchBrowserUrl('http://0.0.0.0:8080')).toBe(true)
    expect(isPrivateWorkbenchBrowserUrl('http://[::1]')).toBe(true)
    expect(isPrivateWorkbenchBrowserUrl('http://[::]')).toBe(true)
  })

  it('treats RFC1918, CGNAT, link-local, documentation, benchmarking, and multicast ranges as private', () => {
    for (const url of [
      'http://10.0.0.5',
      'http://172.16.0.1',
      'http://172.31.255.255',
      'http://192.168.1.1',
      'http://100.64.0.1',
      'http://100.127.255.1',
      'http://169.254.169.254',
      'http://192.0.0.1',
      'http://192.0.2.1',
      'http://198.18.0.1',
      'http://198.19.255.255',
      'http://198.51.100.1',
      'http://203.0.113.5',
      'http://224.0.0.1',
      'http://239.255.255.250',
    ]) {
      expect(isPrivateWorkbenchBrowserUrl(url)).toBe(true)
    }
  })

  it('treats literal IPv6 addresses and invalid URLs as private (conservative)', () => {
    expect(isPrivateWorkbenchBrowserUrl('http://[2001:db8::1]')).toBe(true)
    expect(isPrivateWorkbenchBrowserUrl('https://[2606:4700:4700::1111]')).toBe(true)
    expect(isPrivateWorkbenchBrowserUrl('not a url')).toBe(true)
    expect(isPrivateWorkbenchBrowserUrl('')).toBe(true)
  })

  it('treats public hosts and out-of-range IPv4 as non-private', () => {
    expect(isPrivateWorkbenchBrowserUrl('https://example.com')).toBe(false)
    expect(isPrivateWorkbenchBrowserUrl('https://example.com:8443/path?q=1')).toBe(false)
    expect(isPrivateWorkbenchBrowserUrl('https://sub.example.co.uk')).toBe(false)
    expect(isPrivateWorkbenchBrowserUrl('http://8.8.8.8')).toBe(false)
    expect(isPrivateWorkbenchBrowserUrl('http://1.1.1.1')).toBe(false)
    expect(isPrivateWorkbenchBrowserUrl('http://11.0.0.1')).toBe(false)
    expect(isPrivateWorkbenchBrowserUrl('http://172.32.0.1')).toBe(false)
    expect(isPrivateWorkbenchBrowserUrl('http://192.169.1.1')).toBe(false)
    expect(isPrivateWorkbenchBrowserUrl('http://100.128.0.1')).toBe(false)
    expect(isPrivateWorkbenchBrowserUrl('http://203.0.114.1')).toBe(false)
    expect(isPrivateWorkbenchBrowserUrl('http://198.50.100.1')).toBe(false)
  })
})

describe('isWorkbenchBrowserDrivingControl', () => {
  it('classifies page-driving controls as driving and read-only controls as not', () => {
    for (const kind of ['navigate', 'click', 'click_ref', 'type', 'press', 'scroll', 'dialog']) {
      expect(isWorkbenchBrowserDrivingControl({ kind } as never)).toBe(true)
    }
    for (const kind of ['snapshot', 'console', 'capture', 'follow_start', 'follow_stop', 'kill']) {
      expect(isWorkbenchBrowserDrivingControl({ kind } as never)).toBe(false)
    }
  })
})

describe('workbenchBrowserActorKindFromHeader', () => {
  it('resolves any non-empty header value to agent and null/empty to undefined', () => {
    expect(workbenchBrowserActorKindFromHeader('agent-1')).toBe('agent')
    expect(workbenchBrowserActorKindFromHeader('  agent-1  ')).toBe('agent')
    expect(workbenchBrowserActorKindFromHeader(undefined)).toBeUndefined()
    expect(workbenchBrowserActorKindFromHeader(null)).toBeUndefined()
    expect(workbenchBrowserActorKindFromHeader('')).toBeUndefined()
    expect(workbenchBrowserActorKindFromHeader('   ')).toBeUndefined()
  })
})

describe('parseWorkbenchBrowserProgressChunk', () => {
  it('accepts frame/status/stderr chunks and truncates oversized text', () => {
    expect(parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'frame', imageUrl: 'https://cdn.example.com/f.jpg', contentType: 'image/jpeg', atMs: 1_000 }))
      .toEqual({ seq: 0, stream: 'frame', imageUrl: 'https://cdn.example.com/f.jpg', contentType: 'image/jpeg', atMs: 1_000 })
    expect(parseWorkbenchBrowserProgressChunk({ seq: 1, stream: 'status', text: 'browser session active', atMs: 2_000 }))
      .toEqual({ seq: 1, stream: 'status', text: 'browser session active', atMs: 2_000 })
    const truncated = parseWorkbenchBrowserProgressChunk({ seq: 2, stream: 'stderr', text: 'x'.repeat(3_000), atMs: 3_000 })
    expect(Buffer.byteLength(truncated.text ?? '', 'utf8')).toBe(2_000)
  })

  it('rejects a frame chunk without imageUrl and an invalid contentType', () => {
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'frame', atMs: 1_000 })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'frame', imageUrl: 'https://x', contentType: 'image/gif', atMs: 1_000 })).toThrow('workbench: invalid browser progress chunk')
  })

  it('rejects malformed seq/stream/atMs', () => {
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: -1, stream: 'status', atMs: 1_000 })).toThrow()
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'bogus', atMs: 1_000 })).toThrow()
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'status', atMs: -1 })).toThrow()
  })

  it('accepts a snapshot stream chunk with a valid payload and round-trips it', () => {
    const payload = {
      url: 'https://example.com',
      title: 'Example',
      ax: '<button>Sign in</button>',
      refs: { '@e1': { backendDOMNodeId: 42, role: 'button', name: 'Sign in' } },
      pendingDialog: { type: 'prompt', message: 'Enter your name' },
      frames: [{ frameId: 'f1', parentId: null, url: 'https://example.com', name: 'main' }],
      console: [{ level: 'error', text: 'boom', url: 'https://example.com/app.js', line: 12 }],
    }
    expect(parseWorkbenchBrowserProgressChunk({ seq: 5, stream: 'snapshot', atMs: 5_000, snapshot: payload }))
      .toEqual({ seq: 5, stream: 'snapshot', atMs: 5_000, snapshot: payload })
  })

  it('accepts a console stream chunk with valid entries', () => {
    const entries = [
      { level: 'log', text: 'hello' },
      { level: 'error', text: 'uncaught ReferenceError: x is not defined', url: 'https://example.com/app.js', line: 3 },
    ]
    expect(parseWorkbenchBrowserProgressChunk({ seq: 6, stream: 'console', atMs: 6_000, entries }))
      .toEqual({ seq: 6, stream: 'console', atMs: 6_000, entries })
  })

  it('rejects a snapshot stream without a payload or with an invalid one', () => {
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'snapshot', atMs: 1_000 })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'snapshot', atMs: 1_000, snapshot: null })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'snapshot', atMs: 1_000, snapshot: { ax: 'x'.repeat(12_001), refs: {} } })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'snapshot', atMs: 1_000, snapshot: { ax: 'ok', refs: [] } })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'snapshot', atMs: 1_000, snapshot: { ax: 'ok', refs: { 'bad ref': {} } } })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'snapshot', atMs: 1_000, snapshot: { ax: 'ok', refs: { '@e1': 'not-an-object' } } })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'snapshot', atMs: 1_000, snapshot: { ax: 'ok', refs: { '@e1': { backendDOMNodeId: 1.5 } } } })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'snapshot', atMs: 1_000, snapshot: { ax: 'ok', refs: {}, pendingDialog: 'nope' } })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'snapshot', atMs: 1_000, snapshot: { ax: 'ok', refs: {}, frames: [{ frameId: '' }] } })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'snapshot', atMs: 1_000, snapshot: { ax: 'ok', refs: {}, console: [{ level: 'log', text: 'x'.repeat(301) }] } })).toThrow('workbench: invalid browser progress chunk')
  })

  it('rejects a console stream without entries or with invalid entries', () => {
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'console', atMs: 1_000 })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'console', atMs: 1_000, entries: 'nope' })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'console', atMs: 1_000, entries: [{ level: 'log', text: 'x'.repeat(301) }] })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'console', atMs: 1_000, entries: [{ level: 'l'.repeat(65), text: 'ok' }] })).toThrow('workbench: invalid browser progress chunk')
    expect(() => parseWorkbenchBrowserProgressChunk({ seq: 0, stream: 'console', atMs: 1_000, entries: [{ level: 'log', text: 'ok', line: -1 }] })).toThrow('workbench: invalid browser progress chunk')
  })
})

describe('appendWorkbenchBrowserSessionControl', () => {
  it('caps the FIFO at 64 entries, dropping the oldest first', () => {
    let controls: ReturnType<typeof appendWorkbenchBrowserSessionControl> | undefined
    for (let seq = 0; seq < 70; seq += 1) {
      controls = appendWorkbenchBrowserSessionControl(controls, { seq, control: { kind: 'capture' }, actorUserId: 'user-a', actorKind: 'user', enqueuedAtMs: seq })
    }
    expect(controls).toHaveLength(64)
    expect(controls![0].seq).toBe(6)
    expect(controls![63].seq).toBe(69)
  })

  it('carries the actorKind of the enqueuer through the FIFO', () => {
    const controls = appendWorkbenchBrowserSessionControl(undefined, { seq: 0, control: { kind: 'snapshot' }, actorUserId: 'user-a', actorKind: 'agent', enqueuedAtMs: 1_000 })
    expect(controls).toHaveLength(1)
    expect(controls[0].actorKind).toBe('agent')
    expect(controls[0].control).toEqual({ kind: 'snapshot' })
  })
})

describe('appendWorkbenchBrowserProgressChunk', () => {
  it('caps the ring buffer at 30 entries, dropping the oldest first', () => {
    let chunks: ReturnType<typeof appendWorkbenchBrowserProgressChunk> | undefined
    for (let seq = 0; seq < 40; seq += 1) {
      chunks = appendWorkbenchBrowserProgressChunk(chunks, { seq, stream: 'status', text: 'tick', atMs: seq })
    }
    expect(chunks).toHaveLength(30)
    expect(chunks![0].seq).toBe(10)
    expect(chunks![29].seq).toBe(39)
  })
})

describe('isTerminalWorkbenchBrowserSessionStatus', () => {
  it('classifies terminal vs. non-terminal statuses', () => {
    expect(isTerminalWorkbenchBrowserSessionStatus('awaiting_approval')).toBe(false)
    expect(isTerminalWorkbenchBrowserSessionStatus('queued')).toBe(false)
    expect(isTerminalWorkbenchBrowserSessionStatus('claimed')).toBe(false)
    expect(isTerminalWorkbenchBrowserSessionStatus('running')).toBe(false)
    expect(isTerminalWorkbenchBrowserSessionStatus('exited')).toBe(true)
    expect(isTerminalWorkbenchBrowserSessionStatus('killed')).toBe(true)
    expect(isTerminalWorkbenchBrowserSessionStatus('expired')).toBe(true)
    expect(isTerminalWorkbenchBrowserSessionStatus('failed')).toBe(true)
  })
})

describe('publicWorkbenchBrowserSession', () => {
  it('never exposes encrypted payloads, credentials, or physical paths to the browser', () => {
    const view = publicWorkbenchBrowserSession(queuedSession({
      progressChunks: [{ seq: 0, stream: 'frame', imageUrl: 'https://cdn.example.com/f.jpg', atMs: 1_000 }],
      currentPageUrl: 'https://example.com',
    }))
    expect(view).toMatchObject({ sessionId: 'wbbs_a', status: 'queued', viewport: { width: 1280, height: 720 }, currentPageUrl: 'https://example.com' })
    expect(view.progress).toEqual([{ seq: 0, stream: 'frame', imageUrl: 'https://cdn.example.com/f.jpg', atMs: 1_000 }])
    expect(JSON.stringify(view)).not.toMatch(/encrypted|credential|relativeFolder|Users\//i)
  })

  it('exposes the actor control-plane fields: initiator, driver, and allowPrivateNetwork', () => {
    const view = publicWorkbenchBrowserSession(queuedSession({ driver: 'agent', driverSinceMs: 5_000, allowPrivateNetwork: false }))
    expect(view.initiator).toBe('user')
    expect(view.driver).toBe('agent')
    expect(view.allowPrivateNetwork).toBe(false)
    const idle = publicWorkbenchBrowserSession(queuedSession())
    expect(idle.driver).toBe('idle')
    expect(idle.allowPrivateNetwork).toBe(true)
  })
})

describe('workbench browser session queue transitions', () => {
  it('approves an awaiting_approval session, moving it to queued', () => {
    const approved = transitionWorkbenchBrowserSession(awaitingApprovalSession(), { type: 'approve', approverUserId: 'user-a', nowMs: 1_200 })
    expect(approved).toMatchObject({ status: 'queued', approvedByUserId: 'user-a', approvedAtMs: 1_200 })
  })

  it('rejects approval by a non-owner, a non-awaiting session, or after expiry', () => {
    expect(() => transitionWorkbenchBrowserSession(awaitingApprovalSession(), { type: 'approve', approverUserId: 'user-b', nowMs: 1_200 }))
      .toThrow('workbench: browser session approval owner mismatch')
    expect(() => transitionWorkbenchBrowserSession(queuedSession(), { type: 'approve', approverUserId: 'user-a', nowMs: 1_200 }))
      .toThrow('workbench: browser session is not awaiting approval')
    expect(() => transitionWorkbenchBrowserSession(awaitingApprovalSession({ ttlExpiresAtMs: 1_000 }), { type: 'approve', approverUserId: 'user-a', nowMs: 1_200 }))
      .toThrow('workbench: browser session expired')
  })

  it('claims the create control, generating a lease and incrementing attempt', () => {
    const claimed = transitionWorkbenchBrowserSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    expect(claimed.status).toBe('claimed')
    expect(claimed.attempt).toBe(1)
    expect(claimed.leaseToken).toEqual(expect.any(String))
    expect(claimed.encryptedCreateControl).toBeNull()
    expect(claimed.leaseExpiresAtMs).toBe(92_000)
  })

  it('rejects claiming an already-claimed session, a device/credential mismatch, or an expired session', () => {
    const claimed = transitionWorkbenchBrowserSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    expect(() => transitionWorkbenchBrowserSession(claimed, {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 3_000, leaseMs: 90_000,
    })).toThrow('workbench: browser session already claimed')
    expect(() => transitionWorkbenchBrowserSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-b', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })).toThrow('workbench: device mismatch')
    expect(() => transitionWorkbenchBrowserSession(queuedSession({ ttlExpiresAtMs: 1_500 }), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })).toThrow('workbench: browser session expired')
  })

  it('flips claimed -> running on the first progress call and renews the lease thereafter', () => {
    const claimed = transitionWorkbenchBrowserSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    const running = transitionWorkbenchBrowserSession(claimed, {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3, attempt: claimed.attempt, leaseToken: claimed.leaseToken!,
      nowMs: 5_000, leaseMs: 90_000,
    })
    expect(running.status).toBe('running')
    expect(running.leaseExpiresAtMs).toBe(95_000)

    const renewed = transitionWorkbenchBrowserSession(running, {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3, attempt: running.attempt, leaseToken: running.leaseToken!,
      nowMs: 10_000, leaseMs: 90_000,
    })
    expect(renewed.status).toBe('running')
    expect(renewed.leaseExpiresAtMs).toBe(100_000)
  })

  it('rejects progress with a stale lease or on an unclaimed session', () => {
    const claimed = transitionWorkbenchBrowserSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    expect(() => transitionWorkbenchBrowserSession(claimed, {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3, attempt: claimed.attempt, leaseToken: 'stale',
      nowMs: 5_000, leaseMs: 90_000,
    })).toThrow('workbench: lease mismatch')
    expect(() => transitionWorkbenchBrowserSession(queuedSession(), {
      type: 'progress', deviceId: 'device-a', credentialVersion: 3, attempt: 0, leaseToken: 'none',
      nowMs: 5_000, leaseMs: 90_000,
    })).toThrow('workbench: browser session not claimed')
  })

  it('kills an awaiting_approval or queued session directly (no browser exists yet) but refuses to kill an already-claimed one this way', () => {
    const killedAwaiting = transitionWorkbenchBrowserSession(awaitingApprovalSession(), { type: 'killQueued', nowMs: 4_000 })
    expect(killedAwaiting).toMatchObject({ status: 'killed', encryptedCreateControl: null })
    const killedQueued = transitionWorkbenchBrowserSession(queuedSession(), { type: 'killQueued', nowMs: 4_000 })
    expect(killedQueued).toMatchObject({ status: 'killed', encryptedCreateControl: null })
    expect(() => transitionWorkbenchBrowserSession(queuedSession({ status: 'running' }), { type: 'killQueued', nowMs: 4_000 }))
      .toThrow('workbench: browser session already claimed')
  })

  it('completes a running session and rejects completion with a stale lease', () => {
    const claimed = transitionWorkbenchBrowserSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    const completed = transitionWorkbenchBrowserSession(claimed, {
      type: 'complete', deviceId: 'device-a', credentialVersion: 3, attempt: claimed.attempt, leaseToken: claimed.leaseToken!,
      outcome: 'exited', nowMs: 9_000,
    })
    expect(completed).toMatchObject({ status: 'exited', encryptedCreateControl: null, encryptedControls: null })

    expect(() => transitionWorkbenchBrowserSession(claimed, {
      type: 'complete', deviceId: 'device-a', credentialVersion: 3, attempt: claimed.attempt, leaseToken: 'stale-lease',
      outcome: 'exited', nowMs: 9_000,
    })).toThrow('workbench: lease mismatch')
  })

  it('is idempotent when re-completing with the same outcome', () => {
    const exited = queuedSession({ status: 'exited' })
    expect(transitionWorkbenchBrowserSession(exited, {
      type: 'complete', deviceId: 'device-a', credentialVersion: 3, attempt: 1, leaseToken: 'irrelevant', outcome: 'exited', nowMs: 9_000,
    })).toBe(exited)
  })

  it('expires a claimed session once and leaves a terminal session untouched', () => {
    const claimed = transitionWorkbenchBrowserSession(queuedSession(), {
      type: 'claimCreate', deviceId: 'device-a', credentialVersion: 3, nowMs: 2_000, leaseMs: 90_000,
    })
    const expired = transitionWorkbenchBrowserSession(claimed, { type: 'expire', nowMs: 200_000 })
    expect(expired).toMatchObject({ status: 'expired', encryptedCreateControl: null, encryptedControls: null })
    const exited = queuedSession({ status: 'exited' })
    expect(transitionWorkbenchBrowserSession(exited, { type: 'expire', nowMs: 200_000 })).toBe(exited)
  })
})
