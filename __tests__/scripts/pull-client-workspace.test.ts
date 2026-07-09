import {
  buildPullCommands,
  parsePullWorkspaceArgs,
  slugifyWorkspaceName,
  validateWorkspaceName,
} from '@/scripts/pull-client-workspace'

describe('pull-client-workspace', () => {
  it('builds a dry-run, pull-only plan for Workspace and agent-domain content', () => {
    const options = parsePullWorkspaceArgs([
      '--workspace', 'Vikings Wrestling',
      '--host', 'vps.example.com',
      '--local-root', '/tmp/Cowork',
    ])
    expect(options).toMatchObject({
      workspaceName: 'Vikings Wrestling',
      agentDomain: 'vikings-wrestling',
      host: 'vps.example.com',
      apply: false,
    })
    const commands = buildPullCommands(options)
    expect(commands).toHaveLength(2)
    expect(commands[0]).toEqual(expect.arrayContaining([
      'rsync',
      '--dry-run',
      "root@vps.example.com:'/var/lib/hermes/Cowork/Vikings Wrestling/'",
      '/tmp/Cowork/Vikings Wrestling/',
    ]))
    expect(commands[1]).toEqual(expect.arrayContaining([
      "root@vps.example.com:'/var/lib/hermes/cowork-wiki/agents/vikings-wrestling/'",
      '/tmp/Cowork/Cowork/agents/vikings-wrestling/',
    ]))
    expect(commands[0]).not.toContain('--delete')
  })

  it('adds backups instead of delete semantics in apply mode', () => {
    const options = parsePullWorkspaceArgs([
      '--workspace', 'Acme',
      '--local-root', '/tmp/Cowork',
      '--apply',
    ])
    const [command] = buildPullCommands(options)
    expect(command).toContain('--backup')
    expect(command.some((value) => value.startsWith('--backup-dir=.pib-pull-backups/'))).toBe(true)
    expect(command).not.toContain('--dry-run')
    expect(command).not.toContain('--delete')
  })

  it('rejects traversal and unsafe host input', () => {
    expect(() => validateWorkspaceName('../Client')).toThrow('single safe folder name')
    expect(() => parsePullWorkspaceArgs(['--workspace', 'Acme', '--host', 'host;rm'])).toThrow('Host')
  })

  it('derives stable agent-domain slugs', () => {
    expect(slugifyWorkspaceName("Peet’s Demo & Co")).toBe('peets-demo-co')
  })
})
