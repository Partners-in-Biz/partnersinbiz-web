import {
  applyConflictResolutions,
  buildSyncPlan,
  commonBaseline,
  parseSyncArgs,
  remoteInventoryCommand,
  remoteInventoryScript,
} from '@/scripts/sync-client-workspace'

const PLAN_ID = 'a'.repeat(64)

describe('conflict-aware Workspace sync', () => {
  it('plans canonical VPS changes as pulls and local-only changes as guarded pushes', () => {
    const plan = buildSyncPlan(
      {
        'workspace/remote-change.md': 'base',
        'workspace/local-change.md': 'local-next',
        'workspace/local-only.md': 'local-only',
      },
      {
        'workspace/remote-change.md': 'remote-next',
        'workspace/local-change.md': 'base',
        'workspace/remote-only.md': 'remote-only',
      },
      {
        'workspace/remote-change.md': 'base',
        'workspace/local-change.md': 'base',
      },
      'both',
    )
    expect(plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'workspace/remote-change.md', classification: 'pull', action: 'pull' }),
      expect.objectContaining({ path: 'workspace/local-change.md', classification: 'push', action: 'push' }),
      expect.objectContaining({ path: 'workspace/local-only.md', classification: 'push', action: 'push' }),
      expect.objectContaining({ path: 'workspace/remote-only.md', classification: 'pull', action: 'pull' }),
    ]))
  })

  it('never schedules conflicts or canonical VPS deletion automatically', () => {
    const plan = buildSyncPlan(
      { 'workspace/conflict.md': 'local-next', 'agent/removed-on-vps.md': 'base' },
      { 'workspace/conflict.md': 'remote-next' },
      { 'workspace/conflict.md': 'base', 'agent/removed-on-vps.md': 'base' },
      'both',
    )
    expect(plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'workspace/conflict.md', classification: 'conflict', action: 'none' }),
      expect.objectContaining({ path: 'agent/removed-on-vps.md', classification: 'remote_deleted', action: 'none' }),
    ]))
  })

  it('records explicit per-file conflict resolutions in the reviewed plan', () => {
    const base = buildSyncPlan(
      { 'workspace/conflict.md': 'local' },
      { 'workspace/conflict.md': 'remote' },
      { 'workspace/conflict.md': 'base' },
      'both',
    )
    expect(applyConflictResolutions(base, { 'workspace/conflict.md': 'local' })).toContainEqual(
      expect.objectContaining({ path: 'workspace/conflict.md', action: 'push', resolution: 'local' }),
    )
    expect(() => applyConflictResolutions(base, { 'workspace/missing.md': 'remote' })).toThrow('not found')
  })

  it('restores local deletion but removes a baseline tombstone once both sides agree on absence', () => {
    expect(buildSyncPlan({}, { 'workspace/restore.md': 'base' }, { 'workspace/restore.md': 'base' }, 'pull'))
      .toContainEqual(expect.objectContaining({ classification: 'local_deleted', action: 'pull' }))
    expect(buildSyncPlan({}, {}, { 'workspace/gone.md': 'base' }, 'both'))
      .toContainEqual(expect.objectContaining({ classification: 'unchanged', action: 'none' }))
    expect(commonBaseline({}, {})).toEqual({})
  })

  it('requires an immutable plan id and explicit Markdown path approvals for apply', () => {
    expect(() => parseSyncArgs(['--workspace', 'Acme', '--apply'])).toThrow('immutable 64-character plan id')
    expect(() => parseSyncArgs(['--workspace', 'Acme', '--apply', '--plan', PLAN_ID])).toThrow('--approve-path')
    expect(() => parseSyncArgs([
      '--workspace', 'Acme', '--apply', '--plan', PLAN_ID, '--approve-path', 'workspace/secret.env',
    ])).toThrow('Only Markdown')
    expect(parseSyncArgs([
      '--workspace', 'Acme', '--apply', '--plan', PLAN_ID, '--approve-path', 'workspace/readme.md',
      '--allow-push', '--confirm-workspace', 'workspace-123',
    ])).toMatchObject({
      apply: true,
      planId: PLAN_ID,
      approvedPaths: ['workspace/readme.md'],
      allowPush: true,
      pushWorkspaceId: 'workspace-123',
      workspaceRelativePath: 'partners/Acme',
      orgSlug: 'partners',
    })
  })

  it('nests workspace roots under --org-slug and keeps agent domains flat', () => {
    const nested = parseSyncArgs(['--workspace', 'Hunt and Gun', '--org-slug', 'partners'])
    expect(nested).toMatchObject({
      workspaceName: 'Hunt and Gun',
      workspaceRelativePath: 'partners/Hunt and Gun',
      orgSlug: 'partners',
      agentDomain: 'hunt-and-gun',
    })
    const alreadyNested = parseSyncArgs(['--workspace', 'partners/Hunt and Gun'])
    expect(alreadyNested.workspaceRelativePath).toBe('partners/Hunt and Gun')
    expect(alreadyNested.workspaceName).toBe('Hunt and Gun')

    const script = remoteInventoryScript(nested)
    const encoded = script.match(/b64decode\("([A-Za-z0-9+/=]+)"\)/)?.[1]
    expect(encoded).toBeTruthy()
    const config = JSON.parse(Buffer.from(encoded!, 'base64').toString('utf8')) as {
      expected: { workspace: string; agent: string }
    }
    expect(config.expected.workspace).toBe('/var/lib/hermes/Cowork/partners/Hunt and Gun')
    expect(config.expected.agent).toBe('/var/lib/hermes/cowork-wiki/agents/hunt-and-gun')
    expect(config.expected.workspace).not.toContain('/partners/partners/')
  })

  it('validates target and resolution input', () => {
    expect(() => parseSyncArgs(['--workspace', '../Acme'])).toThrow('single safe folder name')
    expect(() => parseSyncArgs(['--workspace', 'Acme', '--host', 'host;rm'])).toThrow('unsafe')
    expect(() => parseSyncArgs(['--workspace', 'Acme', '--resolve', '../bad.md=local'])).toThrow('Invalid inventory scope')
    expect(parseSyncArgs([
      '--workspace', 'Acme', '--direction', 'both', '--resolve', 'workspace/conflict.md=remote',
    ])).toMatchObject({ resolutions: { 'workspace/conflict.md': 'remote' } })
  })

  it('records only verified equal files in the common baseline', () => {
    expect(commonBaseline(
      { 'workspace/a.md': 'same', 'workspace/b.md': 'local' },
      { 'workspace/a.md': 'same', 'workspace/b.md': 'remote' },
    )).toEqual({ 'workspace/a.md': 'same' })
  })

  it('builds remote inventory through verified SSH stdin and limits inventory to Markdown', () => {
    const options = parseSyncArgs(['--workspace', 'Acme Client', '--host', 'vps.example.com'])
    expect(options.workspaceRelativePath).toBe('partners/Acme Client')
    expect(remoteInventoryCommand(options)).toEqual([
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=yes',
      'root@vps.example.com', 'python3', '-',
    ])
    const script = remoteInventoryScript(options)
    expect(script).toContain('hashlib.sha256')
    expect(script).toContain('base64.b64decode')
    expect(script).toContain('endswith(".md")')
    expect(script).toContain('symlink in sync tree')
    const encoded = script.match(/b64decode\("([A-Za-z0-9+/=]+)"\)/)?.[1]
    expect(encoded).toBeTruthy()
    const config = JSON.parse(Buffer.from(encoded!, 'base64').toString('utf8')) as {
      expected: { workspace: string }
    }
    expect(config.expected.workspace).toBe('/var/lib/hermes/Cowork/partners/Acme Client')
    expect(script).not.toContain('apiKey')
  })
})
