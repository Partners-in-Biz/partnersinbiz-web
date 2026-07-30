import { approvalActorAuditFields, isAuthorizedAdminApprover } from '@/lib/projects/adminApprover'

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
