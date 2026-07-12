import {
  EmailMarketingApprovalError,
  assertEmailMarketingAgentAction,
  validateEmailMarketingApprovalTask,
} from '@/lib/email-marketing/agent-governance'

const maya = {
  uid: 'agent:maya',
  role: 'ai' as const,
  authKind: 'agent_api_key' as const,
  agentId: 'maya',
}

const approved = {
  status: 'approved',
  approvedBy: 'human-1',
  approvedByType: 'user',
  approvalTaskId: 'approval-task-1',
}

describe('email-marketing agent governance', () => {
  it('allows human sessions without applying an agent capability gate', () => {
    expect(assertEmailMarketingAgentAction(
      { uid: 'human-1', role: 'admin', authKind: 'session' },
      'email_marketing_send',
      null,
    )).toEqual({ ok: true, gateRequired: false })
  })

  it('requires server-persisted human approval evidence for agent send actions', () => {
    expect(() => assertEmailMarketingAgentAction(maya, 'email_marketing_send', null))
      .toThrow(EmailMarketingApprovalError)
    expect(() => assertEmailMarketingAgentAction(maya, 'email_marketing_send', {
      ...approved,
      approvedByType: 'agent',
    })).toThrow('human approval')
    expect(() => assertEmailMarketingAgentAction(maya, 'email_marketing_send', {
      ...approved,
      approvalTaskId: '',
    })).toThrow('approval task')

    expect(assertEmailMarketingAgentAction(maya, 'email_marketing_send', approved))
      .toEqual({ ok: true, gateRequired: true })
  })

  it('does not let a legacy shared AI key bypass email launch/send governance', () => {
    expect(() => assertEmailMarketingAgentAction(
      { uid: 'legacy-ai', role: 'ai', authKind: 'legacy_ai_key' },
      'email_marketing_send',
      approved,
    )).toThrow('named agent API key')
  })

  it('keeps read-only agents unable to send even with approval evidence', () => {
    expect(() => assertEmailMarketingAgentAction(
      { uid: 'agent:data', role: 'ai', authKind: 'agent_api_key', agentId: 'data' },
      'email_marketing_send',
      approved,
    )).toThrow("is not allowed to perform 'email_marketing_send'")
  })
})

describe('email-marketing approval task evidence', () => {
  const evidence = {
    status: 'approved', approvedBy: 'human-1', approvedByType: 'user', approvalTaskId: 'task-1',
  }

  it('accepts only a completed, human-approved task from the same organisation linked to the resource', () => {
    expect(validateEmailMarketingApprovalTask(evidence, {
      orgId: 'org-1', status: 'done', approvalStatus: 'approved', deleted: false,
      linkedResource: { type: 'email_broadcast', id: 'broadcast-1' },
    }, { orgId: 'org-1', resourceType: 'email_broadcast', resourceId: 'broadcast-1' })).toEqual(evidence)
  })

  it.each([
    ['different organisation', { orgId: 'org-2', status: 'done', approvalStatus: 'approved', linkedResource: { type: 'email_broadcast', id: 'broadcast-1' } }],
    ['unapproved task', { orgId: 'org-1', status: 'todo', approvalStatus: 'pending', linkedResource: { type: 'email_broadcast', id: 'broadcast-1' } }],
    ['arbitrary task', { orgId: 'org-1', status: 'done', approvalStatus: 'approved', linkedResource: { type: 'email_broadcast', id: 'another' } }],
  ])('rejects %s evidence', (_label, task) => {
    expect(() => validateEmailMarketingApprovalTask(evidence, task, {
      orgId: 'org-1', resourceType: 'email_broadcast', resourceId: 'broadcast-1',
    })).toThrow(EmailMarketingApprovalError)
  })
})
