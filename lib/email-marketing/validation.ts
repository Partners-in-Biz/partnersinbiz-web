import type {
  EmailProgram,
  LaunchLinkedRecord,
  LaunchLinkRegistry,
} from './types'

export type LaunchValidationIssueCode =
  | 'missing_content_version'
  | 'missing_audience_version'
  | 'missing_workflow_version'
  | 'missing_sender_policy'
  | 'missing_reply_policy'
  | 'missing_preference_topic'
  | 'missing_linked_record'
  | 'cross_org_link'
  | 'inactive_link'
  | 'not_approved'
  | 'missing_approval_snapshot'
  | 'missing_legal_basis'
  | 'missing_schedule_policy'

export interface LaunchValidationIssue {
  code: LaunchValidationIssueCode
  field: string
  message: string
}

export interface LaunchValidationResult {
  valid: boolean
  issues: LaunchValidationIssue[]
}

interface LinkCheck {
  field: keyof Pick<
    EmailProgram,
    | 'contentVersionId'
    | 'audienceVersionId'
    | 'workflowVersionId'
    | 'senderPolicyId'
    | 'replyPolicyId'
    | 'preferenceTopicId'
  >
  registry: keyof LaunchLinkRegistry
  missingCode: LaunchValidationIssueCode
  required: boolean
}

export function validateEmailProgramForLaunch(
  program: EmailProgram,
  registry: LaunchLinkRegistry,
): LaunchValidationResult {
  const issues: LaunchValidationIssue[] = []
  const workflowRequired = program.kind === 'lifecycle' || program.kind === 'sales_sequence'
  const linkChecks: LinkCheck[] = [
    { field: 'contentVersionId', registry: 'contentVersions', missingCode: 'missing_content_version', required: true },
    { field: 'audienceVersionId', registry: 'audienceVersions', missingCode: 'missing_audience_version', required: true },
    { field: 'workflowVersionId', registry: 'workflowVersions', missingCode: 'missing_workflow_version', required: workflowRequired },
    { field: 'senderPolicyId', registry: 'senderPolicies', missingCode: 'missing_sender_policy', required: true },
    { field: 'replyPolicyId', registry: 'replyPolicies', missingCode: 'missing_reply_policy', required: true },
    { field: 'preferenceTopicId', registry: 'preferenceTopics', missingCode: 'missing_preference_topic', required: true },
  ]

  for (const check of linkChecks) {
    const id = program[check.field]
    if (!id) {
      if (check.required) {
        issues.push({ code: check.missingCode, field: check.field, message: `${check.field} is required for launch` })
      }
      continue
    }
    validateLinkedRecord(program, check.field, id, registry[check.registry][id], issues)
  }

  if (program.approvalPolicy.required) {
    if (program.approvalState.status !== 'approved') {
      issues.push({ code: 'not_approved', field: 'approvalState', message: 'Program is not approved' })
    }
    if (!program.approvalState.approvedSnapshotId) {
      issues.push({
        code: 'missing_approval_snapshot',
        field: 'approvalState.approvedSnapshotId',
        message: 'Approval evidence snapshot is required',
      })
    }
  }
  if (!program.legalBasisPolicy) {
    issues.push({ code: 'missing_legal_basis', field: 'legalBasisPolicy', message: 'Legal basis policy is required' })
  }
  if (program.status === 'scheduled' && !program.schedulePolicy) {
    issues.push({ code: 'missing_schedule_policy', field: 'schedulePolicy', message: 'Scheduled program requires a schedule policy' })
  }

  return { valid: issues.length === 0, issues }
}

function validateLinkedRecord(
  program: EmailProgram,
  field: string,
  id: string,
  linked: LaunchLinkedRecord | undefined,
  issues: LaunchValidationIssue[],
): void {
  if (!linked) {
    issues.push({ code: 'missing_linked_record', field, message: `${field} references missing record ${id}` })
    return
  }
  if (linked.orgId !== program.orgId) {
    issues.push({ code: 'cross_org_link', field, message: `${field} must belong to the same organisation` })
  }
  if (linked.active === false) {
    issues.push({ code: 'inactive_link', field, message: `${field} references an inactive record` })
  }
}
