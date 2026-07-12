import type { Timestamp } from 'firebase-admin/firestore'

export const EMAIL_PROGRAM_RECORD_TYPE = 'email_program' as const
export const EMAIL_PROGRAM_SCHEMA_VERSION = 2 as const

export type EmailProgramKind =
  | 'broadcast'
  | 'newsletter'
  | 'lifecycle'
  | 'sales_sequence'
  | 'transactional'
  | 'rss'

export type EmailProgramStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type EmailProgramActorType = 'user' | 'agent' | 'system'

export interface EmailProgramActorRef {
  type: EmailProgramActorType
  id: string
}

export interface EmailProgramRecordLink {
  type: 'campaign' | 'project' | 'deal' | 'company' | 'source'
  id: string
}

export interface EmailProgramApprovalPolicy {
  required: boolean
  policyId?: string | null
  makerChecker?: boolean
}

export interface EmailProgramApprovalState {
  status: 'not_required' | 'pending' | 'approved' | 'rejected' | 'revoked'
  approvedSnapshotId: string | null
  approvedAt?: Timestamp | Date | string | null
  approvedBy?: EmailProgramActorRef | null
}

export interface EmailProgramLegalBasisPolicy {
  basis: 'consent' | 'legitimate_interest' | 'contract' | 'legal_obligation'
  jurisdiction?: string | null
  policyVersionId?: string | null
}

export interface EmailProgramSchedulePolicy {
  scheduledFor?: Timestamp | Date | string | null
  timezone?: string | null
  audienceLocalDelivery?: boolean
}

export interface EmailProgramFrequencyPolicy {
  policyId?: string | null
  maxMessages?: number
  windowDays?: number
}

export interface EmailProgramExperimentPolicy {
  experimentId?: string | null
  holdoutPercent?: number
}

export interface EmailProgramLaunchSnapshot {
  id: string
  createdAt: Timestamp | Date | string | null
  contentVersionId: string
  audienceVersionId: string
  workflowVersionId: string | null
  senderPolicyId: string
  replyPolicyId: string
  approvalSnapshotId: string | null
}

export type EmailProgramSourceCollection =
  | 'campaigns'
  | 'broadcasts'
  | 'sequences'
  | 'communication_campaigns'

export interface EmailProgramSourceRef {
  collection: EmailProgramSourceCollection
  id: string
  legacy: boolean
}

interface EmailProgramBase {
  id: string
  orgId: string
  recordType: typeof EMAIL_PROGRAM_RECORD_TYPE
  schemaVersion: typeof EMAIL_PROGRAM_SCHEMA_VERSION
  status: EmailProgramStatus
  name: string
  description: string
  contentVersionId: string | null
  audienceVersionId: string | null
  senderPolicyId: string | null
  replyPolicyId: string | null
  preferenceTopicId: string | null
  approvalPolicy: EmailProgramApprovalPolicy
  approvalState: EmailProgramApprovalState
  legalBasisPolicy: EmailProgramLegalBasisPolicy | null
  schedulePolicy: EmailProgramSchedulePolicy | null
  frequencyPolicy: EmailProgramFrequencyPolicy | null
  experimentPolicy: EmailProgramExperimentPolicy | null
  links: Partial<Record<EmailProgramRecordLink['type'], string>>
  createdBy: EmailProgramActorRef
  updatedBy: EmailProgramActorRef
  launchSnapshot: EmailProgramLaunchSnapshot | null
  createdAt: Timestamp | Date | string | null
  updatedAt: Timestamp | Date | string | null
  source: EmailProgramSourceRef
}

export type EmailProgram =
  | (EmailProgramBase & {
      kind: 'lifecycle' | 'sales_sequence'
      workflowVersionId: string | null
    })
  | (EmailProgramBase & {
      kind: 'broadcast' | 'newsletter' | 'transactional' | 'rss'
      workflowVersionId: string | null
    })

export type NewEmailProgram = Omit<
  EmailProgram,
  'id' | 'recordType' | 'schemaVersion' | 'source' | 'createdAt' | 'updatedAt'
>

export interface LaunchLinkedRecord {
  orgId: string
  active?: boolean
}

export interface LaunchLinkRegistry {
  contentVersions: Record<string, LaunchLinkedRecord | undefined>
  audienceVersions: Record<string, LaunchLinkedRecord | undefined>
  workflowVersions: Record<string, LaunchLinkedRecord | undefined>
  senderPolicies: Record<string, LaunchLinkedRecord | undefined>
  replyPolicies: Record<string, LaunchLinkedRecord | undefined>
  preferenceTopics: Record<string, LaunchLinkedRecord | undefined>
}
