import { classifyWorkspaceBackfill, parseFlags } from '@/scripts/backfill-client-workspaces'

describe('backfill-client-workspaces helpers', () => {
  it('is dry-run by default and parses commit/targeting flags', () => {
    expect(parseFlags([])).toEqual({ dryRun: true, skipVps: false })
    expect(parseFlags(['--commit', '--org-id', 'org-1', '--limit', '5', '--skip-vps'])).toEqual({
      dryRun: false,
      orgId: 'org-1',
      limit: 5,
      skipVps: true,
    })
  })

  it('classifies complete, partial, and missing workspace metadata', () => {
    expect(classifyWorkspaceBackfill({
      org: { workspaceManifest: { workspaceId: 'acme' }, workspaceId: 'acme' },
      workspaceDocExists: true,
    })).toEqual({
      action: 'skip',
      reason: 'workspace manifest and org_workspaces record already exist',
    })

    expect(classifyWorkspaceBackfill({
      org: { workspaceId: 'acme' },
      workspaceDocExists: false,
    })).toEqual({
      action: 'repair',
      reason: 'partial workspace metadata exists; repair missing fields',
    })

    expect(classifyWorkspaceBackfill({
      org: {},
      workspaceDocExists: false,
    })).toEqual({
      action: 'backfill',
      reason: 'missing workspace manifest and org_workspaces record',
    })
  })
})
