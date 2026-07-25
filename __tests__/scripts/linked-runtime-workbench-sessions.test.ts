/** @jest-environment node */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MappingRegistry } from '../../runtime-installers/runtime/bridge'
import {
  __resetWorkbenchSessionsForTests,
  __setNodePtyForTests,
  activeWorkbenchSessionIds,
  handleSessionCreate,
  handleSessionKill,
  handleSessionResize,
  handleSessionStdin,
  isNodePtyAvailable,
  linkedRuntimeWorkbenchSessionsClaimBody,
  pollWorkbenchSessionsForever,
  runWorkbenchSessionClaim,
  sweepIdleWorkbenchSessions,
  type PtyProcess,
  type WorkbenchSessionClaim,
} from '../../runtime-installers/runtime/workbench-sessions'

function mappedWorkspace() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pib-workbench-sessions-'))
  const root = path.join(temporary, 'workspace')
  fs.mkdirSync(root)
  const registry = new MappingRegistry(path.join(temporary, 'mappings.json'))
  registry.map('mapping-a', root)
  return { temporary, root, registry }
}

function createClaim(overrides: Partial<Extract<WorkbenchSessionClaim, { kind: 'create' }>> = {}): WorkbenchSessionClaim {
  return {
    kind: 'create',
    sessionId: 'session-a',
    shell: 'bash',
    cols: 120,
    rows: 40,
    cwd: '.',
    workspaceId: 'workspace-a',
    mappingId: 'mapping-a',
    relativeFolder: '',
    attempt: 1,
    leaseToken: 'lease-token-1234567890',
    ...overrides,
  }
}

function controlClaim(control: Extract<WorkbenchSessionClaim, { kind: 'control' }>['control'], overrides: Partial<Extract<WorkbenchSessionClaim, { kind: 'control' }>> = {}): WorkbenchSessionClaim {
  return {
    kind: 'control',
    sessionId: 'session-a',
    control,
    attempt: 1,
    leaseToken: 'lease-token-1234567890',
    ...overrides,
  }
}

class FakePty implements PtyProcess {
  pid = 4242
  cols: number
  rows: number
  killed = false
  written: string[] = []
  resizes: Array<{ cols: number; rows: number }> = []
  private dataHandlers: Array<(data: string) => void> = []
  private exitHandlers: Array<(event: { exitCode: number; signal?: number }) => void> = []

  constructor(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
  }

  onData(callback: (data: string) => void) {
    this.dataHandlers.push(callback)
  }

  onExit(callback: (event: { exitCode: number; signal?: number }) => void) {
    this.exitHandlers.push(callback)
  }

  write(data: string) {
    this.written.push(data)
  }

  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
    this.resizes.push({ cols, rows })
  }

  kill() {
    this.killed = true
    this.emitExit(0)
  }

  emitData(data: string) {
    for (const handler of this.dataHandlers) handler(data)
  }

  emitExit(exitCode: number, signal?: number) {
    for (const handler of this.exitHandlers) handler({ exitCode, signal })
  }
}

function fakeNodePty(pty: PtyProcess, capture?: { cwd?: string; cols?: number; rows?: number; file?: string; args?: string[] }) {
  return {
    spawn: jest.fn((file: string, args: string[], options: { cols: number; rows: number; cwd: string }) => {
      if (capture) {
        capture.file = file
        capture.args = args
        capture.cwd = options.cwd
        capture.cols = options.cols
        capture.rows = options.rows
      }
      return pty
    }),
  }
}

afterEach(() => {
  __setNodePtyForTests(undefined)
  __resetWorkbenchSessionsForTests()
})

describe('linked-computer workbench interactive sessions runtime', () => {
  it('advertises the sessions claim protocol', () => {
    expect(linkedRuntimeWorkbenchSessionsClaimBody()).toEqual({
      runtimeVersion: expect.any(String),
      workbenchSessionsProtocolVersion: 1,
    })
  })

  it('fails session create with a clear error when node-pty is unavailable', async () => {
    const { registry } = mappedWorkspace()
    __setNodePtyForTests(null)
    expect(isNodePtyAvailable()).toBe(false)
    const post = jest.fn(async () => new Response('', { status: 200 }))
    await expect(handleSessionCreate(createClaim(), registry, post)).rejects.toThrow(/node-pty/i)
  })

  it('spawns a jailed login shell, streams stdout progress, and posts completion on exit', async () => {
    const { root, registry } = mappedWorkspace()
    fs.mkdirSync(path.join(root, 'src'))
    const pty = new FakePty(120, 40)
    const capture: { cwd?: string; file?: string; args?: string[] } = {}
    __setNodePtyForTests(fakeNodePty(pty, capture))

    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      return new Response('', { status: 200 })
    })

    const result = await handleSessionCreate(
      createClaim({ cwd: 'src', cols: 100, rows: 30, shell: 'zsh' }),
      registry,
      post,
    )
    expect(result).toEqual({ sessionId: 'session-a', pid: 4242 })
    expect(capture.cwd).toBe(fs.realpathSync(path.join(root, 'src')))
    expect(capture.file).toMatch(/zsh$/)
    expect(activeWorkbenchSessionIds()).toContain('session-a')

    pty.emitData('hello from shell\n')
    expect(posts).toHaveLength(1)
    expect(posts[0][0]).toBe('/workbench/sessions/session-a/progress')
    expect(posts[0][1]).toEqual({
      attempt: 1,
      leaseToken: 'lease-token-1234567890',
      chunk: { seq: 1, stream: 'stdout', text: 'hello from shell\n', atMs: expect.any(Number) },
    })

    pty.emitExit(0)
    expect(activeWorkbenchSessionIds()).not.toContain('session-a')
    const completion = posts.find(([endpoint]) => endpoint.endsWith('/complete'))
    expect(completion?.[1]).toEqual({
      attempt: 1,
      leaseToken: 'lease-token-1234567890',
      outcome: 'exited',
      exitCode: 0,
    })
  })

  it('rejects a session create cwd that escapes the mapped root via traversal or symlink', async () => {
    const { temporary, root, registry } = mappedWorkspace()
    const outside = path.join(temporary, 'outside')
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(root, 'escape-dir'))
    __setNodePtyForTests(fakeNodePty(new FakePty(120, 40)))
    const post = jest.fn(async () => new Response('', { status: 200 }))

    await expect(
      handleSessionCreate(createClaim({ cwd: '../outside' }), registry, post),
    ).rejects.toThrow(/unsafe workbench path/i)
    await expect(
      handleSessionCreate(createClaim({ sessionId: 'session-b', cwd: 'escape-dir' }), registry, post),
    ).rejects.toThrow(/containment|symlink/i)
  })

  it('rejects malformed session claims before touching node-pty or the filesystem', async () => {
    const { registry } = mappedWorkspace()
    const spawn = jest.fn()
    __setNodePtyForTests({ spawn })
    const post = jest.fn(async () => new Response('', { status: 200 }))

    await expect(
      handleSessionCreate(createClaim({ leaseToken: 'short' }), registry, post),
    ).rejects.toThrow(/invalid workbench session claim/i)
    await expect(
      handleSessionCreate(createClaim({ attempt: 0 }), registry, post),
    ).rejects.toThrow(/invalid workbench session claim/i)
    await expect(
      handleSessionCreate(createClaim({ mappingId: '../mapping' }), registry, post),
    ).rejects.toThrow(/invalid workbench session claim/i)
    await expect(
      handleSessionCreate(createClaim({ shell: 'fish' as never }), registry, post),
    ).rejects.toThrow(/invalid workbench session claim/i)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('rejects malformed control claims (bad kind, oversized stdin, out-of-range resize)', async () => {
    const { registry } = mappedWorkspace()
    __setNodePtyForTests(fakeNodePty(new FakePty(120, 40)))
    const post = jest.fn(async () => new Response('', { status: 200 }))

    await expect(
      runWorkbenchSessionClaim(controlClaim({ kind: 'resize', cols: 0, rows: 40 }), registry, post),
    ).rejects.toThrow(/invalid workbench session/i)
    await expect(
      runWorkbenchSessionClaim(controlClaim({ kind: 'stdin', data: 'x'.repeat(8_001), mode: 'raw' }), registry, post),
    ).rejects.toThrow(/invalid workbench session/i)
    await expect(
      runWorkbenchSessionClaim({ kind: 'control', sessionId: 'session-a', control: { kind: 'teleport' } as never, attempt: 1, leaseToken: 'lease-token-1234567890' }, registry, post),
    ).rejects.toThrow(/invalid workbench session/i)
  })

  it('writes stdin in raw and line modes, appending a newline only when missing', async () => {
    const { registry } = mappedWorkspace()
    const pty = new FakePty(120, 40)
    __setNodePtyForTests(fakeNodePty(pty))
    const post = jest.fn(async () => new Response('', { status: 200 }))
    await handleSessionCreate(createClaim(), registry, post)

    handleSessionStdin('session-a', 'echo hi', 'line')
    handleSessionStdin('session-a', 'already-newline\n', 'line')
    handleSessionStdin('session-a', 'raw-no-newline', 'raw')

    expect(pty.written).toEqual(['echo hi\n', 'already-newline\n', 'raw-no-newline'])
  })

  it('rejects oversized stdin and stdin/resize targeting an unknown session', () => {
    expect(() => handleSessionStdin('missing-session', 'x')).toThrow(/not found/i)
    expect(() => handleSessionResize('missing-session', 80, 24)).toThrow(/not found/i)
    expect(() => handleSessionStdin('bad id!', 'x')).toThrow(/invalid workbench session id/i)
  })

  it('resizes within bounds and clamps out-of-range requests to the current size', async () => {
    const { registry } = mappedWorkspace()
    const pty = new FakePty(80, 24)
    __setNodePtyForTests(fakeNodePty(pty))
    const post = jest.fn(async () => new Response('', { status: 200 }))
    await handleSessionCreate(createClaim({ cols: 80, rows: 24 }), registry, post)

    handleSessionResize('session-a', 120, 40)
    expect(pty.resizes).toEqual([{ cols: 120, rows: 40 }])

    handleSessionResize('session-a', 999_999, -5)
    expect(pty.resizes[1]).toEqual({ cols: 120, rows: 40 })
  })

  it('kills a session and posts a killed completion via the exit handler', async () => {
    const { registry } = mappedWorkspace()
    const pty = new FakePty(120, 40)
    __setNodePtyForTests(fakeNodePty(pty))
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      return new Response('', { status: 200 })
    })
    await handleSessionCreate(createClaim(), registry, post)

    handleSessionKill('session-a')
    expect(pty.killed).toBe(true)
    const completion = posts.find(([endpoint]) => endpoint.endsWith('/complete'))
    expect(completion?.[1]).toEqual(expect.objectContaining({ outcome: 'killed' }))
    expect(activeWorkbenchSessionIds()).not.toContain('session-a')

    // Killing an already-gone session is a no-op, not an error.
    expect(() => handleSessionKill('session-a')).not.toThrow()
  })

  it('sweeps idle sessions past the TTL and reports a killed completion', async () => {
    const { registry } = mappedWorkspace()
    const pty = new FakePty(120, 40)
    __setNodePtyForTests(fakeNodePty(pty))
    const posts: Array<[string, Record<string, unknown>]> = []
    const post = jest.fn(async (endpoint: string, body: Record<string, unknown>) => {
      posts.push([endpoint, body])
      return new Response('', { status: 200 })
    })
    const startedAt = Date.now()
    await handleSessionCreate(createClaim(), registry, post)

    sweepIdleWorkbenchSessions(startedAt + 5 * 60_000, 10 * 60_000)
    expect(pty.killed).toBe(false)

    sweepIdleWorkbenchSessions(startedAt + 11 * 60_000, 10 * 60_000)
    expect(pty.killed).toBe(true)
    const completion = posts.find(([endpoint]) => endpoint.endsWith('/complete'))
    expect(completion?.[1]).toEqual(expect.objectContaining({ outcome: 'killed' }))
  })

  it('dispatches create/stdin/resize/kill claim kinds through runWorkbenchSessionClaim', async () => {
    const { registry } = mappedWorkspace()
    const pty = new FakePty(120, 40)
    __setNodePtyForTests(fakeNodePty(pty))
    const post = jest.fn(async () => new Response('', { status: 200 }))

    await runWorkbenchSessionClaim(createClaim(), registry, post)
    await runWorkbenchSessionClaim(controlClaim({ kind: 'stdin', data: 'ls', mode: 'line' }), registry, post)
    await runWorkbenchSessionClaim(controlClaim({ kind: 'resize', cols: 100, rows: 40 }), registry, post)
    await runWorkbenchSessionClaim(controlClaim({ kind: 'kill' }), registry, post)

    expect(pty.written).toEqual(['ls\n'])
    expect(pty.resizes).toEqual([{ cols: 100, rows: 40 }])
    expect(pty.killed).toBe(true)
  })

  it('polls session claims independently with the shared idle-backoff shape', async () => {
    const claimed = controlClaim({ kind: 'kill' })
    const run = jest.fn(async () => undefined)
    let claims = 0
    await pollWorkbenchSessionsForever(
      async () => (++claims === 1 ? claimed : null),
      run,
      () => claims > 1,
      async () => undefined,
    )
    expect(run).toHaveBeenCalledWith(claimed)
  })
})
