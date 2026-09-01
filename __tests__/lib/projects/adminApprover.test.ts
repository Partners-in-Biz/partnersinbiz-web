const mockLoadStaff = jest.fn()

jest.mock('@/lib/orgMembers/platform-staff', () => ({
  loadPlatformStaffMembership: (...args: unknown[]) => mockLoadStaff(...args),
}))

import {
  approvalActorAuditFields,
  canApproveProjectGate,
  isAuthorizedAdminApprover,
  isAuthorizedBookApprover,
} from '@/lib/projects/adminApprover'

describe('isAuthorizedAdminApprover', () => {
  it('allows direct human admin sessions', () => {
    expect(isAuthorizedAdminApprover({ uid: 'peet', role: 'admin', authKind: 'session' })).toBe(true)
    expect(isAuthorizedAdminApprover({ uid: 'peet', role: 'admin', authKind: 'firebase' })).toBe(true)
  })

  it('allows complete delegated admin sessions acting for the human admin', () => {
    expect(isAuthorizedAdminApprover({
      uid: 'peet',
      role: 'admin',
      authKind: 'user_delegation',
      actingForUserId: 'peet',
      agentId: 'pip',
      delegationId: 'dlg-1',
    })).toBe(true)
  })

  it('rejects non-admins, agent keys, and incomplete delegations', () => {
    expect(isAuthorizedAdminApprover({ uid: 'client', role: 'client', authKind: 'session' })).toBe(false)
    expect(isAuthorizedAdminApprover({
      uid: 'peet', role: 'admin', authKind: 'agent_api_key', agentId: 'pip',
    })).toBe(false)
    expect(isAuthorizedAdminApprover({
      uid: 'peet', role: 'admin', authKind: 'legacy_ai_key',
    })).toBe(false)
    expect(isAuthorizedAdminApprover({
      uid: 'peet', role: 'admin', authKind: 'user_delegation', actingForUserId: 'peet', agentId: 'pip',
    })).toBe(false)
    expect(isAuthorizedAdminApprover({
      uid: 'peet',
      role: 'admin',
      authKind: 'user_delegation',
      actingForUserId: 'other',
      agentId: 'pip',
      delegationId: 'dlg-1',
    })).toBe(false)
    expect(isAuthorizedAdminApprover({
      uid: 'client',
      role: 'client',
      authKind: 'user_delegation',
      actingForUserId: 'client',
      agentId: 'pip',
      delegationId: 'dlg-1',
    })).toBe(false)
  })

  it('records delegated vs direct approval audit fields', () => {
    expect(approvalActorAuditFields({
      uid: 'peet', role: 'admin', authKind: 'session',
    })).toEqual({ approvedBy: 'peet', approvedByType: 'user' })

    expect(approvalActorAuditFields({
      uid: 'peet',
      role: 'admin',
      authKind: 'user_delegation',
      agentId: 'pip',
      delegationId: 'dlg-1',
      actingForUserId: 'peet',
    })).toEqual({
      approvedBy: 'peet',
      approvedByType: 'delegated_user',
      approvedByAgentId: 'pip',
      approvalDelegationId: 'dlg-1',
    })
  })
})

describe('book-of-business approver', () => {
  const staffUser = {
    uid: 'stean',
    role: 'client' as const,
    authKind: 'user_delegation' as const,
    actingForUserId: 'stean',
    agentId: 'pip',
    delegationId: 'dlg-1',
  }

  beforeEach(() => {
    mockLoadStaff.mockReset()
  })

  it('allows PiB staff to approve finance and client-visible gates', async () => {
    mockLoadStaff.mockResolvedValue({ platformOrgId: 'pib-platform-owner', uid: 'stean', role: 'member', policy: {} })
    await expect(canApproveProjectGate(staffUser, 'finance')).resolves.toBe(true)
    await expect(canApproveProjectGate(staffUser, 'client-visible')).resolves.toBe(true)
    await expect(isAuthorizedBookApprover(staffUser, 'finance')).resolves.toBe(true)
  })

  it('rejects production and secret gates for staff members', async () => {
    mockLoadStaff.mockResolvedValue({ platformOrgId: 'pib-platform-owner', uid: 'stean', role: 'member', policy: {} })
    await expect(canApproveProjectGate(staffUser, 'production-deploy')).resolves.toBe(false)
    await expect(canApproveProjectGate(staffUser, 'secret-config')).resolves.toBe(false)
    await expect(isAuthorizedAdminApprover(staffUser)).toBe(false)
  })

  it('still allows platform admins on production gates', async () => {
    await expect(canApproveProjectGate({
      uid: 'peet', role: 'admin', authKind: 'session',
    }, 'production-deploy')).resolves.toBe(true)
  })
})
