import {
  buildSyncPlan,
  commonBaseline,
  parseSyncArgs,
  remoteInventoryCommand,
  remoteInventoryScript,
} from '@/scripts/sync-client-workspace'

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

  it('never schedules conflicting edits or a canonical VPS deletion automatically', () => {
    const plan = buildSyncPlan(
      {
        'workspace/conflict.md': 'local-next',
        'agent/removed-on-vps.md': 'base',
      },
      {
        'workspace/conflict.md': 'remote-next',
      },
      {
        'workspace/conflict.md': 'base',
        'agent/removed-on-vps.md': 'base',
      },
      'both',
    )

    expect(plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'workspace/conflict.md', classification: 'conflict', action: 'none' }),
      expect.objectContaining({ path: 'agent/removed-on-vps.md', classification: 'remote_deleted', action: 'none' }),
    ]))
  })

  it('restores a locally deleted file from VPS without delete semantics', () => {
    expect(buildSyncPlan(
      {},
      { 'workspace/restore.md': 'base' },
      { 'workspace/restore.md': 'base' },
      'pull',
    )).toContainEqual(expect.objectContaining({ classification: 'local_deleted', action: 'pull' }))
  })

  it('requires explicit push approval in apply mode and validates path/host input', () => {
    expect(() => parseSyncArgs(['--workspace', 'Acme', '--direction', 'both', '--apply'])).toThrow('--allow-push')
    expect(() => parseSyncArgs(['--workspace', '../Acme'])).toThrow('single safe folder name')
    expect(() => parseSyncArgs(['--workspace', 'Acme', '--host', 'host;rm'])).toThrow('unsafe')
    expect(parseSyncArgs(['--workspace', 'Acme', '--direction', 'both', '--apply', '--allow-push'])).toMatchObject({
      workspaceName: 'Acme',
      agentDomain: 'acme',
      direction: 'both',
      apply: true,
      allowPush: true,
    })
  })

  it('records only verified equal files in the next common baseline', () => {
    expect(commonBaseline(
      { 'workspace/a.md': 'same', 'workspace/b.md': 'local' },
      { 'workspace/a.md': 'same', 'workspace/b.md': 'remote' },
    )).toEqual({ 'workspace/a.md': 'same' })
  })

  it('builds remote inventory through stdin without exposing shell paths as commands', () => {
    const options = parseSyncArgs(['--workspace', 'Acme Client', '--host', 'vps.example.com'])
    expect(remoteInventoryCommand(options)).toEqual([
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'root@vps.example.com', 'python3', '-',
    ])
    const script = remoteInventoryScript(options)
    expect(script).toContain('hashlib.sha256')
    expect(script).toContain('base64.b64decode')
    expect(script).not.toContain('apiKey')
  })
})
