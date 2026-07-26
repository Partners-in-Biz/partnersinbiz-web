import { attachWorkbenchDiffs, mergeWorkbenchDirectory, runConversationWorkbenchJob, WORKBENCH_ROOT_PATH, workbenchEntriesToTree, workbenchStatusToChanges } from '@/lib/messages/workbench/client'

describe('runConversationWorkbenchJob', () => {
  afterEach(() => jest.restoreAllMocks())

  it('uses the API root-path contract for top-level file listings', () => {
    expect(WORKBENCH_ROOT_PATH).toBe('.')
  })

  it('creates and polls a typed job without sending caller-selected binding identifiers', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: 'job-1', status: 'queued' } }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: 'job-1', status: 'completed', result: { entries: [] } } }), { status: 200 }))

    const result = await runConversationWorkbenchJob('conv-1', { kind: 'fs.list', path: '.' }, { pollDelayMs: 0 })

    expect(result.result).toEqual({ entries: [] })
    const create = fetchMock.mock.calls[0]
    expect(create[0]).toBe('/api/v1/conversations/conv-1/workbench/jobs')
    expect(JSON.parse(String((create[1] as RequestInit).body))).toEqual({ operation: { kind: 'fs.list', path: '.' } })
    expect(String((create[1] as RequestInit).body)).not.toMatch(/orgId|deviceId|mappingId|runtimeTarget/)
  })

  it('requires an explicit approval callback before approving a write', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: 'job-write', status: 'awaiting_approval' } }), { status: 202 }))

    await expect(runConversationWorkbenchJob('conv-1', { kind: 'fs.write', path: 'src/a.ts', content: 'next', expectedSha256: 'a'.repeat(64) }, { pollDelayMs: 0 }))
      .rejects.toThrow(/approval/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('approves a write only after the caller opted in', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: 'job-write', status: 'awaiting_approval' } }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: 'job-write', status: 'queued' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { jobId: 'job-write', status: 'completed', result: { bytesWritten: 4, sha256: 'b'.repeat(64) } } }), { status: 200 }))

    const result = await runConversationWorkbenchJob('conv-1', { kind: 'fs.write', path: 'src/a.ts', content: 'next', expectedSha256: 'a'.repeat(64) }, { approveWrite: true, pollDelayMs: 0 })

    expect(result.status).toBe('completed')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/conversations/conv-1/workbench/jobs/job-write/approve')
  })
})

describe('workbench result adapters', () => {
  it('builds a nested file tree from live list entries', () => {
    expect(workbenchEntriesToTree([
      { path: 'src', type: 'directory' },
      { path: 'src/app.ts', type: 'file' },
      { path: 'README.md', type: 'file' },
    ])).toEqual([
      { name: 'src', path: 'src', kind: 'directory', children: [{ name: 'app.ts', path: 'src/app.ts', kind: 'file' }] },
      { name: 'README.md', path: 'README.md', kind: 'file' },
    ])
  })

  it('merges a lazy directory listing into the existing live tree', () => {
    const root = workbenchEntriesToTree([{ path: 'src', type: 'directory' }])
    expect(mergeWorkbenchDirectory(root, 'src', [{ path: 'src/app.ts', type: 'file' }])).toEqual([
      { name: 'src', path: 'src', kind: 'directory', children: [{ name: 'app.ts', path: 'src/app.ts', kind: 'file' }] },
    ])
  })

  it('maps live git status into workbench changes', () => {
    expect(workbenchStatusToChanges([
      { path: 'new.ts', status: 'untracked' },
      { path: 'old.ts', status: 'deleted' },
    ])).toEqual([
      { path: 'new.ts', status: 'added' },
      { path: 'old.ts', status: 'deleted' },
    ])
  })

  it('attaches each live git diff section to its changed file', () => {
    const changes = workbenchStatusToChanges([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'src/b.ts', status: 'modified' },
    ])
    const diff = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@\n-old\n+new\ndiff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@\n-one\n+two\n'
    expect(attachWorkbenchDiffs(changes, diff)[0].patch).toContain('+new')
    expect(attachWorkbenchDiffs(changes, diff)[1].patch).toContain('+two')
    expect(attachWorkbenchDiffs(changes, diff)[0].patch).not.toContain('+two')
  })
})
