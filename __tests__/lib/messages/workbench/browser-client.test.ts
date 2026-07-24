import {
  createWorkbenchIdempotencyKey,
  enqueueWorkbenchOperation,
  formatWorkbenchOperationResult,
  gitStatusResultToChanges,
  mapTerminalCommandToOperation,
  pollWorkbenchJob,
  runWorkbenchOperation,
} from '@/lib/messages/workbench/browser-client'
import type { PublicWorkbenchJob } from '@/lib/messages/workbench/jobs'

describe('createWorkbenchIdempotencyKey', () => {
  it('prefixes a unique key each call', () => {
    const first = createWorkbenchIdempotencyKey('terminal')
    const second = createWorkbenchIdempotencyKey('terminal')
    expect(first).toMatch(/^terminal-/)
    expect(second).toMatch(/^terminal-/)
    expect(first).not.toEqual(second)
  })
})

describe('mapTerminalCommandToOperation', () => {
  it.each([
    ['git status', { kind: 'git.status' }],
    ['git diff', { kind: 'git.diff' }],
    ['git diff --stat', { kind: 'git.diff' }],
    ['ls', { kind: 'fs.list', path: '.' }],
  ] as const)('maps %s to %j', (command, expected) => {
    expect(mapTerminalCommandToOperation(command)).toEqual(expected)
  })

  it('returns null for pwd (handled specially, no device round trip)', () => {
    expect(mapTerminalCommandToOperation('pwd')).toBeNull()
  })

  it('returns null for unrecognised commands', () => {
    expect(mapTerminalCommandToOperation('rm -rf /')).toBeNull()
    expect(mapTerminalCommandToOperation('')).toBeNull()
  })
})

describe('gitStatusResultToChanges', () => {
  it('maps raw git status codes onto the workbench change status union', () => {
    expect(gitStatusResultToChanges({
      changes: [
        { path: 'new.ts', status: 'untracked' },
        { path: 'old.ts', status: 'deleted' },
        { path: 'edited.ts', status: 'modified' },
        { path: 'moved.ts', status: 'renamed' },
        { path: 'weird.ts', status: 'copied' },
      ],
    })).toEqual([
      { path: 'new.ts', status: 'added' },
      { path: 'old.ts', status: 'deleted' },
      { path: 'edited.ts', status: 'modified' },
      { path: 'moved.ts', status: 'renamed' },
      { path: 'weird.ts', status: 'unknown' },
    ])
  })

  it('returns an empty array for a missing or malformed result', () => {
    expect(gitStatusResultToChanges(undefined)).toEqual([])
    expect(gitStatusResultToChanges(null)).toEqual([])
    expect(gitStatusResultToChanges({ changes: undefined } as never)).toEqual([])
  })
})

describe('formatWorkbenchOperationResult', () => {
  const base = { jobId: 'job-1', createdAt: '', updatedAt: '', approvalRequired: false }

  it('renders git.status changes as short status lines', () => {
    const job: PublicWorkbenchJob = {
      ...base, kind: 'git.status', status: 'completed',
      result: { changes: [{ path: 'a.ts', status: 'modified' }] },
    }
    expect(formatWorkbenchOperationResult(job)).toBe('modified   a.ts')
  })

  it('renders a clean git.status as no changes', () => {
    const job: PublicWorkbenchJob = { ...base, kind: 'git.status', status: 'completed', result: { changes: [] } }
    expect(formatWorkbenchOperationResult(job)).toMatch(/clean/)
  })

  it('renders git.diff output verbatim', () => {
    const job: PublicWorkbenchJob = { ...base, kind: 'git.diff', status: 'completed', result: { diff: '--- a\n+++ b\n' } }
    expect(formatWorkbenchOperationResult(job)).toBe('--- a\n+++ b')
  })

  it('renders fs.list entries as a path listing', () => {
    const job: PublicWorkbenchJob = {
      ...base, kind: 'fs.list', status: 'completed',
      result: { entries: [{ path: 'src', type: 'directory' }, { path: 'README.md', type: 'file' }] },
    }
    expect(formatWorkbenchOperationResult(job)).toBe('src/\nREADME.md')
  })

  it('surfaces awaiting_approval and terminal failure states', () => {
    expect(formatWorkbenchOperationResult({ ...base, kind: 'fs.write', status: 'awaiting_approval', approvalRequired: true }))
      .toMatch(/approval/i)
    expect(formatWorkbenchOperationResult({ ...base, kind: 'git.status', status: 'failed', error: 'git repository boundary unavailable' }))
      .toBe('git repository boundary unavailable')
  })
})

describe('enqueueWorkbenchOperation / pollWorkbenchJob / runWorkbenchOperation', () => {
  afterEach(() => jest.restoreAllMocks())

  it('POSTs the operation with a generated Idempotency-Key header', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: 'job-1', status: 'queued' } }), { status: 202 }))

    const job = await enqueueWorkbenchOperation('conv-1', { kind: 'git.status' })

    expect(job).toEqual({ jobId: 'job-1', status: 'queued' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/conversations/conv-1/workbench/jobs')
    expect((init as RequestInit).method).toBe('POST')
    expect(new Headers((init as RequestInit).headers).get('Idempotency-Key')).toMatch(/^workbench-/)
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ operation: { kind: 'git.status' } })
  })

  it('polls until a terminal status is reached', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: 'job-1', status: 'claimed' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: 'job-1', status: 'completed', result: { changes: [] } } }), { status: 200 }))

    const job = await pollWorkbenchJob('conv-1', 'job-1', { intervalMs: 0 })
    expect(job.status).toBe('completed')
  })

  it('runWorkbenchOperation enqueues then polls through to completion', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: 'job-2', status: 'queued' } }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: 'job-2', status: 'completed', result: { entries: [] } } }), { status: 200 }))

    const job = await runWorkbenchOperation('conv-1', { kind: 'fs.list', path: '.' }, { intervalMs: 0 })
    expect(job).toEqual({ jobId: 'job-2', status: 'completed', result: { entries: [] } })
  })

  it('runWorkbenchOperation stops without polling when the job needs approval', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: 'job-3', status: 'awaiting_approval' } }), { status: 202 }))

    const job = await runWorkbenchOperation('conv-1', { kind: 'fs.write', path: 'a.ts', content: 'x' }, { intervalMs: 0 })
    expect(job.status).toBe('awaiting_approval')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('pollWorkbenchJob times out waiting for a stuck job', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ data: { jobId: 'job-4', status: 'queued' } }), { status: 200 }))

    await expect(pollWorkbenchJob('conv-1', 'job-4', { timeoutMs: 5, intervalMs: 0 })).rejects.toThrow(/timed out/i)
  })
})
