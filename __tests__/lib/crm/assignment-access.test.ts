import {
  crmActorCanReadRecord,
  isCrmPrivilegedActor,
} from '@/lib/crm/assignment-access'
import {
  FULL_ACCESS_POLICY,
  normalizeMemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'
import type { CrmAuthContext } from '@/lib/auth/crm-middleware'

function ctx(overrides: Partial<CrmAuthContext>): CrmAuthContext {
  return {
    orgId: 'org-1',
    uid: 'uid-admin',
    actor: { uid: 'uid-admin', displayName: 'Admin User', kind: 'human' },
    role: 'admin',
    isAgent: false,
    permissions: {},
    accessPolicy: FULL_ACCESS_POLICY,
    ...overrides,
  }
}

describe('CRM assignment access policy integration', () => {
  it('keeps default admins privileged when their policy is full access', () => {
    expect(isCrmPrivilegedActor(ctx({}))).toBe(true)
  })

  it('does not treat owner-narrowed admins as privileged for record filtering', () => {
    const narrowed = ctx({
      accessPolicy: normalizeMemberAccessPolicy({
        preset: 'custom',
        modules: { crm: true },
        recordScopes: { crm: 'owned_or_linked', projects: 'owned_or_linked' },
      }),
    })

    expect(isCrmPrivilegedActor(narrowed)).toBe(false)
    expect(crmActorCanReadRecord(narrowed, { id: 'c1', orgId: 'org-1', assignedTo: 'uid-other' })).toBe(false)
    expect(crmActorCanReadRecord(narrowed, { id: 'c2', orgId: 'org-1', assignedTo: 'uid-admin' })).toBe(true)
  })
})
