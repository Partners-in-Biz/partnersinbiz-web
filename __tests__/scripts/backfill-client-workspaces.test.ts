import { classifyWorkspaceBackfill, parseFlags } from '@/scripts/backfill-client-workspaces'

describe('backfill-client-workspaces helpers', () => {
  it('is dry-run by default and parses commit/targeting flags', () => {
    expect(parseFlags([])).toEqual({ dryRun: true, skipVps: false, includePlatform: false })
    expect(parseFlags([
      '--commit', '--org-id', 'pib-platform-owner', '--workspace-domain', 'partners',
      '--include-platform', '--limit', '5', '--skip-vps',
    ])).toEqual({
      dryRun: false,
      orgId: 'pib-platform-owner',
      workspaceDomain: 'partners',
      includePlatform: true,
      limit: 5,
      skipVps: true,
    })
  })

  it('classifies complete, partial, and missing workspace metadata', () => {
    expect(classifyWorkspaceBackfill({
      org: { workspaceManifest: { workspaceId: 'acme' }, workspaceId: 'acme' },
      workspaceDocExists: true,
      expectedWorkspaceId: 'acme',
    })).toEqual({
      action: 'skip',
      reason: 'workspace manifest and org_workspaces record already exist',
    })

    expect(classifyWorkspaceBackfill({
      org: { workspaceId: 'acme' },
      workspaceDocExists: false,
      expectedWorkspaceId: 'acme',
    })).toEqual({
      action: 'repair',
      reason: 'partial workspace metadata exists; repair missing fields',
    })

    expect(classifyWorkspaceBackfill({
      org: {},
      workspaceDocExists: false,
      expectedWorkspaceId: 'acme',
    })).toEqual({
      action: 'backfill',
      reason: 'missing workspace manifest and org_workspaces record',
    })
  })

  it('requires review rather than repointing an existing workspace id', () => {
    expect(classifyWorkspaceBackfill({
      org: { workspaceManifest: { workspaceId: 'old-acme' }, workspaceId: 'old-acme' },
      workspaceDocExists: false,
      expectedWorkspaceId: 'new-acme',
    })).toEqual({
      action: 'review_required',
      reason: 'existing workspaceId old-acme differs from derived new-acme',
    })
  })
})
