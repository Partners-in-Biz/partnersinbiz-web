import type { EmailProgram, LaunchLinkRegistry } from '@/lib/email-marketing/types'
import { validateEmailProgramForLaunch } from '@/lib/email-marketing/validation'

function launchableProgram(overrides: Partial<EmailProgram> = {}): EmailProgram {
  return {
    id: 'program-1',
    orgId: 'org-a',
    recordType: 'email_program',
    schemaVersion: 2,
    kind: 'newsletter',
    status: 'approved',
    name: 'Monthly newsletter',
    description: '',
    contentVersionId: 'content-1',
    audienceVersionId: 'audience-1',
    workflowVersionId: null,
    senderPolicyId: 'sender-1',
    replyPolicyId: 'reply-1',
    preferenceTopicId: 'topic-1',
    approvalPolicy: { required: true },
    approvalState: { status: 'approved', approvedSnapshotId: 'approval-1' },
    legalBasisPolicy: { basis: 'consent', jurisdiction: 'ZA' },
    schedulePolicy: null,
    frequencyPolicy: { policyId: 'frequency-1' },
    experimentPolicy: null,
    links: {},
    createdBy: { type: 'user', id: 'user-1' },
    updatedBy: { type: 'user', id: 'user-1' },
    launchSnapshot: null,
    createdAt: null,
    updatedAt: null,
    source: { collection: 'campaigns', id: 'program-1', legacy: false },
    ...overrides,
  }
}

function registry(overrides: Partial<LaunchLinkRegistry> = {}): LaunchLinkRegistry {
  return {
    contentVersions: { 'content-1': { orgId: 'org-a', active: true } },
    audienceVersions: { 'audience-1': { orgId: 'org-a', active: true } },
    workflowVersions: {},
    senderPolicies: { 'sender-1': { orgId: 'org-a', active: true } },
    replyPolicies: { 'reply-1': { orgId: 'org-a', active: true } },
    preferenceTopics: { 'topic-1': { orgId: 'org-a', active: true } },
    ...overrides,
  }
}

describe('validateEmailProgramForLaunch', () => {
  test('accepts an approved program with active same-org launch links', () => {
    expect(validateEmailProgramForLaunch(launchableProgram(), registry())).toEqual({ valid: true, issues: [] })
  })

  test('reports all missing launch-critical links', () => {
    const result = validateEmailProgramForLaunch(launchableProgram({
      contentVersionId: null,
      audienceVersionId: null,
      senderPolicyId: null,
      replyPolicyId: null,
      preferenceTopicId: null,
    }), registry())

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'missing_content_version',
      'missing_audience_version',
      'missing_sender_policy',
      'missing_reply_policy',
      'missing_preference_topic',
    ]))
  })

  test('requires a workflow version for lifecycle and sales sequence programs', () => {
    const result = validateEmailProgramForLaunch(
      launchableProgram({ kind: 'lifecycle', workflowVersionId: null }),
      registry(),
    )
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing_workflow_version' }))
  })

  test('blocks cross-organisation and inactive linked records', () => {
    const result = validateEmailProgramForLaunch(launchableProgram(), registry({
      senderPolicies: { 'sender-1': { orgId: 'org-b', active: true } },
      audienceVersions: { 'audience-1': { orgId: 'org-a', active: false } },
    }))

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'cross_org_link', field: 'senderPolicyId' }),
      expect.objectContaining({ code: 'inactive_link', field: 'audienceVersionId' }),
    ]))
  })

  test('requires approval evidence and legal basis', () => {
    const result = validateEmailProgramForLaunch(launchableProgram({
      approvalState: { status: 'pending', approvedSnapshotId: null },
      legalBasisPolicy: null,
    }), registry())

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'not_approved' }),
      expect.objectContaining({ code: 'missing_approval_snapshot' }),
      expect.objectContaining({ code: 'missing_legal_basis' }),
    ]))
  })

  test('scheduled programs require a schedule policy', () => {
    const result = validateEmailProgramForLaunch(
      launchableProgram({ status: 'scheduled', schedulePolicy: null }),
      registry(),
    )
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing_schedule_policy' }))
  })
})
