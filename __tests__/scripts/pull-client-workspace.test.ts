import {
  buildPullCommands,
  parsePullWorkspaceArgs,
  slugifyWorkspaceName,
  validateWorkspaceName,
} from '@/scripts/pull-client-workspace'

describe('pull-client-workspace', () => {
  it('builds a dry-run, pull-only plan for nested Workspace and flat agent-domain content', () => {
    const options = parsePullWorkspaceArgs([
      '--workspace', 'Vikings Wrestling',
      '--host', 'vps.example.com',
      '--local-root', '/tmp/Cowork',
    ])
    expect(options).toMatchObject({
      workspaceName: 'Vikings Wrestling',
      workspaceRelativePath: 'partners/Vikings Wrestling',
      orgSlug: 'partners',
      agentDomain: 'vikings-wrestling',
      host: 'vps.example.com',
      apply: false,
    })
    const commands = buildPullCommands(options)
    expect(commands).toHaveLength(2)
    expect(commands[0]).toEqual(expect.arrayContaining([
      'rsync',
      '--dry-run',
      "root@vps.example.com:'/var/lib/hermes/Cowork/partners/Vikings Wrestling/'",
      '/tmp/Cowork/partners/Vikings Wrestling/',
    ]))
    expect(commands[1]).toEqual(expect.arrayContaining([
      "root@vps.example.com:'/var/lib/hermes/cowork-wiki/agents/vikings-wrestling/'",
      '/tmp/Cowork/Cowork/agents/vikings-wrestling/',
    ]))
    expect(commands[0]).not.toContain('--delete')
  })

  it('does not double-nest when workspace already includes the org slug', () => {
    const options = parsePullWorkspaceArgs([
      '--workspace', 'partners/Hunt and Gun',
      '--host', 'vps.example.com',
      '--local-root', '/tmp/Cowork',
      '--org-slug', 'partners',
    ])
    expect(options).toMatchObject({
      workspaceName: 'Hunt and Gun',
      workspaceRelativePath: 'partners/Hunt and Gun',
      orgSlug: 'partners',
      agentDomain: 'hunt-and-gun',
    })
    const [command] = buildPullCommands(options)
    expect(command).toEqual(expect.arrayContaining([
      "root@vps.example.com:'/var/lib/hermes/Cowork/partners/Hunt and Gun/'",
      '/tmp/Cowork/partners/Hunt and Gun/',
    ]))
  })

  it('honours --org-slug for tenant nests', () => {
    const options = parsePullWorkspaceArgs([
      '--workspace', 'Acme',
      '--org-slug', 'acme',
      '--local-root', '/tmp/Cowork',
    ])
    expect(options.workspaceRelativePath).toBe('acme/Acme')
    expect(buildPullCommands(options)[0]).toEqual(expect.arrayContaining([
      "root@hermes-api.partnersinbiz.online:'/var/lib/hermes/Cowork/acme/Acme/'",
      '/tmp/Cowork/acme/Acme/',
    ]))
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

  it('can pull only the Workspace when the local Obsidian domain is already authoritative', () => {
    const options = parsePullWorkspaceArgs([
      '--workspace', 'Partners in Biz',
      '--agent-domain', 'partners',
      '--local-root', '/tmp/Cowork',
      '--skip-agent-domain',
    ])
    expect(options.skipAgentDomain).toBe(true)
    expect(options.workspaceRelativePath).toBe('partners/Partners in Biz')
    expect(buildPullCommands(options)).toHaveLength(1)
  })

  it('rejects traversal and unsafe host input', () => {
    expect(() => validateWorkspaceName('../Client')).toThrow('single safe folder name')
    expect(() => parsePullWorkspaceArgs(['--workspace', 'Acme', '--host', 'host;rm'])).toThrow('Host')
  })

  it('derives stable agent-domain slugs', () => {
    expect(slugifyWorkspaceName("Peet’s Demo & Co")).toBe('peets-demo-co')
  })
})
