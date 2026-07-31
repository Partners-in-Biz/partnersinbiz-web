import { loadFinanceActorContext } from '@/lib/finance/firestore-context'
import type { ApiUser } from '@/lib/api/types'

function fakeDb(membership: Record<string, unknown>, assignments: Record<string, unknown>[] = []) {
  return {
    collection(name: string) {
      if (name === 'orgMembers') return {
        doc: () => ({ get: async () => ({ exists: true, data: () => membership }) }),
      }
      if (name === 'finance_role_assignments') {
        const query = {
          where: () => query,
          get: async () => ({ docs: assignments.map((data, index) => ({ id: `assignment-${index}`, data: () => data })) }),
        }
        return query
      }
      throw new Error(`unexpected collection ${name}`)
    },
  }
}

const user: ApiUser = { uid: 'user-a', role: 'client', authKind: 'session', orgId: 'org-a' }
const assignment = { orgId: 'org-a', userId: 'user-a', legalEntityId: 'entity-a', scopeMode: 'entity',
  role: 'finance_admin', status: 'active' }

describe('finance actor context persistence boundary', () => {
  test('loads only active canonical membership with persisted billing/Finance capability', async () => {
    const context = await loadFinanceActorContext(user, 'org-a', {
      db: fakeDb({ role: 'admin', status: 'active', accessPolicy: { preset: 'finance', modules: { billing: true } } }, [assignment]) as never,
    })
    expect(context).toEqual(expect.objectContaining({ membershipActive: true, financeModuleEnabled: true }))
    expect(context.assignments).toHaveLength(1)
  })

  test('denies inactive membership and persisted module denial', async () => {
    await expect(loadFinanceActorContext(user, 'org-a', {
      db: fakeDb({ role: 'admin', status: 'inactive', accessPolicy: { modules: { billing: true } } }, [assignment]) as never,
    })).rejects.toThrow('Active organization membership')
    await expect(loadFinanceActorContext(user, 'org-a', {
      db: fakeDb({ role: 'admin', status: 'active', accessPolicy: { preset: 'custom', modules: { billing: false } } }, [assignment]) as never,
    })).rejects.toThrow('Persisted Finance module capability')
  })

  test('denies delegated identity with wrong org or missing finance action scope', async () => {
    const delegated: ApiUser = { ...user, authKind: 'user_delegation', actingForUserId: user.uid,
      delegationId: 'delegation-a', delegationScopes: ['finance:journal.post'] }
    await expect(loadFinanceActorContext({ ...delegated, orgId: 'org-b' }, 'org-a', { db: fakeDb({}) as never }))
      .rejects.toThrow('Delegation identity and organization scope')
    await expect(loadFinanceActorContext({ ...delegated, delegationScopes: ['documents:create'] }, 'org-a', { db: fakeDb({}) as never }))
      .rejects.toThrow('does not grant a finance scope')
  })
})
