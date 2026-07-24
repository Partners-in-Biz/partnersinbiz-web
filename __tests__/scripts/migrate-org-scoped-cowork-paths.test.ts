import {
  PARTNERS_MAC_WORKSPACE_MAPPING_ID,
  PARTNERS_MAC_WORKSPACE_NESTED_PATH,
  RESERVED_COWORK_ROOT_NAMES,
  buildFirestoreMergePatch,
  buildVpsMigrationBash,
  classifyMoveCandidate,
  parseFlags,
  planLinkedComputerMappingsUpdate,
  resolveMigrationScopes,
  rewriteConversationDoc,
  rewriteOrganizationDoc,
  rewriteOrgWorkspaceDoc,
  rewritePathFieldsInObject,
  rewriteCoworkPathValue,
  shellSingleQuote,
} from '@/scripts/lib/org-scoped-cowork-migration'

describe('migrate-org-scoped-cowork-paths helpers', () => {
  it('defaults to dry-run and parses scope flags', () => {
    expect(parseFlags([], {})).toEqual(expect.objectContaining({
      dryRun: true,
      macOnly: false,
      vpsOnly: false,
      firestoreOnly: false,
      skipFirestore: false,
      skipVps: false,
      skipMac: false,
      host: '65.108.146.144',
    }))

    expect(parseFlags(['--commit', '--mac-only'], { PIB_VPS_HOST: 'hermes-vps-01' })).toEqual(
      expect.objectContaining({
        dryRun: false,
        macOnly: true,
        host: 'hermes-vps-01',
      }),
    )

    expect(parseFlags(['--skip-vps', '--skip-firestore', '--host', '1.2.3.4'], {})).toEqual(
      expect.objectContaining({
        dryRun: true,
        skipVps: true,
        skipFirestore: true,
        host: '1.2.3.4',
      }),
    )

    expect(() => parseFlags(['--mac-only', '--vps-only'], {})).toThrow(/only one of/)
    expect(() => parseFlags(['--unknown'], {})).toThrow(/Unknown argument/)
  })

  it('resolves migration scopes from exclusive and skip flags', () => {
    expect(resolveMigrationScopes(parseFlags(['--mac-only'], {}))).toEqual({
      mac: true,
      vps: false,
      firestore: false,
    })
    expect(resolveMigrationScopes(parseFlags(['--vps-only'], {}))).toEqual({
      mac: false,
      vps: true,
      firestore: false,
    })
    expect(resolveMigrationScopes(parseFlags(['--firestore-only'], {}))).toEqual({
      mac: false,
      vps: false,
      firestore: true,
    })
    expect(resolveMigrationScopes(parseFlags(['--skip-mac', '--skip-vps'], {}))).toEqual({
      mac: false,
      vps: false,
      firestore: true,
    })
    expect(resolveMigrationScopes(parseFlags([], {}))).toEqual({
      mac: true,
      vps: true,
      firestore: true,
    })
  })

  it('classifies move candidates and reserved Cowork root entries', () => {
    expect(RESERVED_COWORK_ROOT_NAMES.has('Cowork')).toBe(true)
    expect(RESERVED_COWORK_ROOT_NAMES.has('Partners in Biz — Client Growth')).toBe(true)
    expect(RESERVED_COWORK_ROOT_NAMES.has('Side Projects')).toBe(true)
    expect(RESERVED_COWORK_ROOT_NAMES.has('YouTube Business')).toBe(true)
    expect(RESERVED_COWORK_ROOT_NAMES.has('partners')).toBe(true)

    expect(classifyMoveCandidate({ name: 'Hunt and Gun', kind: 'directory' })).toEqual({
      action: 'move',
      reason: 'Partners-era flat workspace',
      folderName: 'Hunt and Gun',
      fromRelative: 'Hunt and Gun',
      toRelative: 'partners/Hunt and Gun',
    })

    expect(classifyMoveCandidate({ name: 'Partners in Biz', kind: 'directory' }).action).toBe('move')

    expect(classifyMoveCandidate({ name: 'Cowork', kind: 'directory' })).toEqual(
      expect.objectContaining({ action: 'skip', reason: 'reserved Cowork root entry' }),
    )
    expect(classifyMoveCandidate({ name: 'partners', kind: 'directory' })).toEqual(
      expect.objectContaining({ action: 'skip', reason: 'destination nest already present' }),
    )
    expect(classifyMoveCandidate({ name: '.claude', kind: 'directory' })).toEqual(
      expect.objectContaining({ action: 'skip', reason: 'dot entry' }),
    )
    expect(classifyMoveCandidate({ name: 'CLAUDE.md', kind: 'file' })).toEqual(
      expect.objectContaining({ action: 'skip', reason: 'not a directory' }),
    )
    expect(classifyMoveCandidate({ name: 'AHS Law', kind: 'symlink' })).toEqual(
      expect.objectContaining({ action: 'skip', reason: expect.stringContaining('symlink') }),
    )
  })

  it('rewrites path values and nested path objects idempotently', () => {
    expect(rewriteCoworkPathValue('~/Cowork/Hunt and Gun')).toBe('~/Cowork/partners/Hunt and Gun')
    expect(rewriteCoworkPathValue('~/Cowork/partners/Hunt and Gun')).toBeNull()
    expect(rewriteCoworkPathValue('~/Cowork/Cowork/agents/hunt-and-gun')).toBeNull()
    expect(rewriteCoworkPathValue('/var/lib/hermes/Cowork/AHS Law/docs')).toBe(
      '/var/lib/hermes/Cowork/partners/AHS Law/docs',
    )

    const orgWorkspace = rewriteOrgWorkspaceDoc({
      localPath: '~/Cowork/Hunt and Gun',
      vpsPath: '/var/lib/hermes/Cowork/Hunt and Gun',
      agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/hunt-and-gun',
      localAgentDomainPath: '~/Cowork/Cowork/agents/hunt-and-gun',
      manifest: {
        localPath: '~/Cowork/Hunt and Gun',
        vpsPath: '/var/lib/hermes/Cowork/Hunt and Gun',
        agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/hunt-and-gun',
      },
      unrelated: 'keep-me',
    })

    expect(orgWorkspace.changed).toBe(true)
    expect(orgWorkspace.next).toEqual(expect.objectContaining({
      localPath: '~/Cowork/partners/Hunt and Gun',
      vpsPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
      agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/hunt-and-gun',
      localAgentDomainPath: '~/Cowork/Cowork/agents/hunt-and-gun',
      unrelated: 'keep-me',
      manifest: expect.objectContaining({
        localPath: '~/Cowork/partners/Hunt and Gun',
        vpsPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
        agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/hunt-and-gun',
      }),
    }))
    expect(orgWorkspace.changes.map((c) => c.fieldPath).sort()).toEqual([
      'localPath',
      'manifest.localPath',
      'manifest.vpsPath',
      'vpsPath',
    ])

    const alreadyNested = rewritePathFieldsInObject({
      localPath: '~/Cowork/partners/Hunt and Gun',
      vpsPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
    })
    expect(alreadyNested.changed).toBe(false)
  })

  it('rewrites organization folderRegistry syncTargets and conversation workspaceContext', () => {
    const organization = rewriteOrganizationDoc({
      workspaceManifest: {
        localPath: '~/Cowork/Partners in Biz',
        vpsPath: '/var/lib/hermes/Cowork/Partners in Biz',
      },
      folderRegistry: [
        {
          key: 'workspace',
          syncTargets: {
            localPath: '~/Cowork/Partners in Biz',
            vpsPath: '/var/lib/hermes/Cowork/Partners in Biz',
          },
        },
        {
          key: 'agent-domain',
          syncTargets: {
            localPath: '~/Cowork/Cowork/agents/partners',
            vpsPath: '/var/lib/hermes/Cowork/Cowork/agents/partners',
          },
        },
      ],
    })

    expect(organization.changed).toBe(true)
    expect(organization.next).toEqual(expect.objectContaining({
      workspaceManifest: {
        localPath: '~/Cowork/partners/Partners in Biz',
        vpsPath: '/var/lib/hermes/Cowork/partners/Partners in Biz',
      },
      folderRegistry: [
        {
          key: 'workspace',
          syncTargets: {
            localPath: '~/Cowork/partners/Partners in Biz',
            vpsPath: '/var/lib/hermes/Cowork/partners/Partners in Biz',
          },
        },
        {
          key: 'agent-domain',
          syncTargets: {
            localPath: '~/Cowork/Cowork/agents/partners',
            vpsPath: '/var/lib/hermes/Cowork/Cowork/agents/partners',
          },
        },
      ],
    }))

    const conversation = rewriteConversationDoc({
      title: 'keep',
      workspaceContext: {
        localPath: '~/Cowork/AHS Law',
        vpsPath: '/var/lib/hermes/Cowork/AHS Law',
        localWorkingPath: '~/Cowork/AHS Law/docs',
        vpsWorkingPath: '/var/lib/hermes/Cowork/AHS Law/docs',
        agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/ahs-law',
      },
    })
    expect(conversation.changed).toBe(true)
    expect(conversation.next.workspaceContext).toEqual(expect.objectContaining({
      localPath: '~/Cowork/partners/AHS Law',
      vpsPath: '/var/lib/hermes/Cowork/partners/AHS Law',
      localWorkingPath: '~/Cowork/partners/AHS Law/docs',
      vpsWorkingPath: '/var/lib/hermes/Cowork/partners/AHS Law/docs',
      agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/ahs-law',
    }))
    expect(conversation.next.title).toBe('keep')
  })

  it('builds a minimal Firestore merge patch from rewrite changes', () => {
    const rewritten = rewriteOrgWorkspaceDoc({
      localPath: '~/Cowork/Echo',
      vpsPath: '/var/lib/hermes/Cowork/Echo',
      status: 'active',
      manifest: {
        localPath: '~/Cowork/Echo',
        vpsPath: '/var/lib/hermes/Cowork/Echo',
        orgName: 'Echo',
      },
    })
    expect(buildFirestoreMergePatch(rewritten)).toEqual({
      localPath: '~/Cowork/partners/Echo',
      vpsPath: '/var/lib/hermes/Cowork/partners/Echo',
      manifest: {
        localPath: '~/Cowork/partners/Echo',
        vpsPath: '/var/lib/hermes/Cowork/partners/Echo',
        orgName: 'Echo',
      },
    })
    expect(buildFirestoreMergePatch({ changed: false, next: {}, changes: [] })).toEqual({})
  })

  it('plans linked-computer mapping update for partners-mac-workspace only', () => {
    const plan = planLinkedComputerMappingsUpdate({
      [PARTNERS_MAC_WORKSPACE_MAPPING_ID]: '/Users/peetstander/Cowork/Partners in Biz',
      '5d60aed3-e9c3-4f69-94a3-50f59ae96742':
        '/Users/peetstander/Cowork/Partners in Biz — Client Growth',
    })

    expect(plan.changed).toBe(true)
    expect(plan.next).toEqual({
      [PARTNERS_MAC_WORKSPACE_MAPPING_ID]: PARTNERS_MAC_WORKSPACE_NESTED_PATH,
      '5d60aed3-e9c3-4f69-94a3-50f59ae96742':
        '/Users/peetstander/Cowork/Partners in Biz — Client Growth',
    })
    expect(plan.changes).toEqual([{
      mappingId: PARTNERS_MAC_WORKSPACE_MAPPING_ID,
      from: '/Users/peetstander/Cowork/Partners in Biz',
      to: PARTNERS_MAC_WORKSPACE_NESTED_PATH,
    }])

    expect(planLinkedComputerMappingsUpdate({
      [PARTNERS_MAC_WORKSPACE_MAPPING_ID]: PARTNERS_MAC_WORKSPACE_NESTED_PATH,
    }).changed).toBe(false)
  })

  it('builds a VPS bash script that nests under partners and quotes folder names', () => {
    expect(shellSingleQuote("Peet's Mac")).toBe(`'Peet'\\''s Mac'`)

    const script = buildVpsMigrationBash({
      folderNames: ['Hunt and Gun', "Saaiman & Saaiman", 'Partners in Biz'],
      dryRun: true,
    })

    expect(script).toContain("ROOT='/var/lib/hermes/Cowork'")
    expect(script).toContain("NEST='partners'")
    expect(script).toContain('DRY_RUN=1')
    expect(script).toContain("'Hunt and Gun'")
    expect(script).toContain("'Saaiman & Saaiman'")
    expect(script).toContain("'Partners in Biz'")
    expect(script).toContain('WOULD_MOVE')
    expect(script).toContain('ln -s')

    const commitScript = buildVpsMigrationBash({
      folderNames: ['Echo'],
      dryRun: false,
    })
    expect(commitScript).toContain('DRY_RUN=0')
    expect(commitScript).toContain('mkdir -p "$NEST_DIR"')
  })
})
