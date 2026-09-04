/**
 * @jest-environment node
 */
import type { ApiUser } from '@/lib/api/types'
import { assertCanCreateRoutine, assertCanManageRoutine, RoutineAuthError } from '@/lib/routines/service'

jest.mock('@/lib/orgMembers/permissions', () => ({
  canManageOrgAs: jest.fn(async (_user: ApiUser, _orgId: string, _role: string) => false),
}))

jest.mock('@/lib/organizations/feature-flags', () => ({
  orgFeatureFlagEnabled: jest.fn(async () => true),
}))

jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))

import { canManageOrgAs } from '@/lib/orgMembers/permissions'

const owner: ApiUser = { uid: 'u-owner', role: 'client' } as ApiUser
const other: ApiUser = { uid: 'u-other', role: 'client' } as ApiUser
const admin: ApiUser = { uid: 'u-admin', role: 'admin' } as ApiUser

describe('routine API auth (personal vs org)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('allows personal routine owner and rejects other members', async () => {
    await expect(assertCanManageRoutine(owner, {
      orgId: 'org-1',
      ownerUserId: 'u-owner',
      accessScope: 'personal',
    })).resolves.toBeUndefined()

    await expect(assertCanManageRoutine(other, {
      orgId: 'org-1',
      ownerUserId: 'u-owner',
      accessScope: 'personal',
    })).rejects.toBeInstanceOf(RoutineAuthError)
  })

  it('requires org admin for organisation routines', async () => {
    ;(canManageOrgAs as jest.Mock).mockResolvedValueOnce(false)
    await expect(assertCanCreateRoutine(other, 'org-1', 'organization')).rejects.toBeInstanceOf(RoutineAuthError)

    ;(canManageOrgAs as jest.Mock).mockResolvedValueOnce(true)
    await expect(assertCanCreateRoutine(other, 'org-1', 'organization')).resolves.toBeUndefined()

    ;(canManageOrgAs as jest.Mock).mockResolvedValueOnce(true)
    await expect(assertCanManageRoutine(admin, {
      orgId: 'org-1',
      ownerUserId: 'u-owner',
      accessScope: 'organization',
    })).resolves.toBeUndefined()
  })

  it('allows platform admin on personal routines', async () => {
    await expect(assertCanManageRoutine(admin, {
      orgId: 'org-1',
      ownerUserId: 'u-owner',
      accessScope: 'personal',
    })).resolves.toBeUndefined()
  })
})
