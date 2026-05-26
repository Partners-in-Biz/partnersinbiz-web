import {
  buildOrgMemberBackfillPlan,
  parseFlags,
} from '@/scripts/crm-claim-flow-readiness'

describe('crm-claim-flow-readiness script helpers', () => {
  it('defaults to dry-run and supports commit/org filters', () => {
    expect(parseFlags([])).toEqual({ dryRun: true, batchSize: 300 })
    expect(parseFlags(['--commit', '--org-id', 'org-1'])).toEqual({
      dryRun: false,
      orgId: 'org-1',
      batchSize: 300,
    })
    expect(parseFlags(['--commit', '--dry-run'])).toMatchObject({ dryRun: true })
  })

  it('plans missing orgMembers from legacy organization members without duplicating existing docs', () => {
    const plan = buildOrgMemberBackfillPlan('org-1', [
      { userId: 'owner-1', role: 'owner' },
      { userId: 'admin-1', role: 'admin' },
      { userId: 'bad-role', role: 'superuser' },
      { userId: '' },
      null,
    ], new Set(['org-1_admin-1']))

    expect(plan).toEqual([
      { key: 'org-1_owner-1', orgId: 'org-1', uid: 'owner-1', role: 'owner' },
      { key: 'org-1_bad-role', orgId: 'org-1', uid: 'bad-role', role: 'member' },
    ])
  })
})
