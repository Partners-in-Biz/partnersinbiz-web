export type BookStudioResourceKey =
  | 'projects'
  | 'briefs'
  | 'series'
  | 'artifact-links'
  | 'publishing-packets'
  | 'rights-ledgers'
  | 'package-manifests'
  | 'analytics-imports'
  | 'decision-logs'

export type BookStudioStage =
  | 'intake'
  | 'research'
  | 'brief'
  | 'quality_gates'
  | 'publishing_packet'
  | 'manual_upload_review'
  | 'analytics_reconciliation'

export type BookStudioStatus =
  | 'not_started'
  | 'draft'
  | 'internal_review'
  | 'client_review'
  | 'approved'
  | 'needs_review'
  | 'blocked'
  | 'ready_for_human_review'
  | 'approved_for_manual_next_step'
  | 'archived'

export type BookStudioGateStatus = 'pass' | 'warning' | 'block' | 'not_applicable' | 'missing_evidence'
export type BookStudioChannel = 'kdp' | 'google_play_books' | 'apple_books' | 'kobo' | 'draft2digital' | 'ingram' | 'acx' | 'manual_handoff' | 'local_publisher'
export type BookStudioBridgeLinkType = 'research' | 'client_document' | 'project_task' | 'artifact' | 'evidence' | 'approval'

export type BookStudioBridgeLink = {
  id?: string
  type: BookStudioBridgeLinkType
  label: string
  ref: string
  href?: string
  status?: string
  version?: string
  checksum?: string
  requiredForApproval?: boolean
}

export type BookStudioRecord = {
  id?: string
  orgId: string
  projectId?: string
  seriesId?: string
  title?: string
  name?: string
  status?: BookStudioStatus
  stage?: BookStudioStage
  channel?: BookStudioChannel
  safeSummary?: string
  nextAction?: string
  deleted?: boolean
  bridgeLinks?: BookStudioBridgeLink[]
  [key: string]: unknown
}

export type BookStudioResourceConfig = {
  collection: string
  label: string
  titleField: 'title' | 'name' | 'label' | 'importLabel' | 'decision'
  defaultStatus: BookStudioStatus
}
