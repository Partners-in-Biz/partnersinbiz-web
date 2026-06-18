export interface OrgSummary {
  id: string
  name: string
  slug?: string
}

export interface SoftwareBuildEvidenceRow {
  kind: 'commit' | 'verification' | 'link' | 'document' | 'blocker'
  label: string
  value: string
  href?: string
}

export type AgentOutputReviewStatus = 'pass' | 'warning' | 'blocked'

export interface AgentOutputReviewArtifact {
  type: string
  label: string
  ref: string
  href?: string
}

export interface AgentOutputQualityCheck {
  label: string
  status: AgentOutputReviewStatus
  detail: string
}

export interface AgentOutputApprovalGate {
  label: string
  status: AgentOutputReviewStatus
  value: string
  href?: string
}

export interface AgentOutputReviewCard {
  summary: string
  evidence: SoftwareBuildEvidenceRow[]
  artifacts: AgentOutputReviewArtifact[]
  qualityChecks: AgentOutputQualityCheck[]
  approvalGates: AgentOutputApprovalGate[]
  nextAction: string
}

export interface AgentLearningReviewLink {
  label: string
  href: string
  type: string
}

export interface AgentLearningReviewCard {
  automationGuard: string
  skillLinks: AgentLearningReviewLink[]
  wikiLinks: AgentLearningReviewLink[]
  taskLinks: AgentLearningReviewLink[]
  proposedChanges: string[]
  sourceDocumentId?: string | null
  approvalGateTaskId?: string | null
}

export interface BriefingCard {
  id: string
  orgId: string
  priority: 'critical' | 'needs-peet' | 'client-risk' | 'review' | 'progress' | 'fyi'
  title: string
  summary: string
  excerpt?: string | null
  timeAgo?: string
  requiresAction?: boolean
  source: { type: string; id: string; url?: string }
  actor: { id: string; name?: string | null; role?: string; type?: string }
  context: {
    orgId: string
    orgName?: string | null
    orgSlug?: string | null
    companyId?: string | null
    companyName?: string | null
    projectId?: string | null
    projectName?: string | null
    taskId?: string | null
    taskTitle?: string | null
    documentId?: string | null
    documentTitle?: string | null
    conversationId?: string | null
    conversationTitle?: string | null
    contactId?: string | null
    contactName?: string | null
    dealId?: string | null
    dealTitle?: string | null
    reportId?: string | null
    reportTitle?: string | null
    bookingId?: string | null
    bookingName?: string | null
    supportTicketId?: string | null
    supportTicketSubject?: string | null
    invoiceId?: string | null
    invoiceNumber?: string | null
    quoteId?: string | null
    quoteNumber?: string | null
    orderId?: string | null
    orderTitle?: string | null
    inventoryItemId?: string | null
    inventoryItemName?: string | null
    shipmentId?: string | null
    shipmentTrackingNumber?: string | null
    expenseId?: string | null
    expenseCategory?: string | null
    seoContentId?: string | null
    seoContentTitle?: string | null
    seoTaskId?: string | null
    seoTaskTitle?: string | null
    seoSprintId?: string | null
    adCampaignId?: string | null
    adCampaignName?: string | null
    broadcastId?: string | null
    broadcastName?: string | null
    campaignId?: string | null
    campaignName?: string | null
    enquiryId?: string | null
    enquiryName?: string | null
    formId?: string | null
    formSubmissionId?: string | null
    formName?: string | null
    socialInboxId?: string | null
    socialInboxFrom?: string | null
    socialPostId?: string | null
    mailboxMessageId?: string | null
    mailboxFrom?: string | null
    mailboxSubject?: string | null
    agentRunId?: string | null
    agentProfile?: string | null
    workspaceBrokerJobId?: string | null
    workspaceBrokerOperation?: string | null
    workspaceArtifactId?: string | null
    workspaceArtifactTitle?: string | null
    calendarEventId?: string | null
    calendarEventTitle?: string | null
  }
  metadata?: Record<string, unknown> | null
  decisionRequest?: {
    prompt: string
    scope: 'internal' | 'client' | 'prospect' | 'public'
    source: string
    reason?: string | null
  } | null
  options?: Array<{
    id: string
    label: string
    description?: string | null
    recommended?: boolean
    disabled?: boolean
    disabledReason?: string | null
  }> | null
  recommendedOption?: { id: string; label: string } | null
  inputTarget?: {
    action: string
    resourceType: string
    resourceId: string
    orgId?: string | null
    method?: 'state' | 'route' | 'copy' | 'chat'
  } | null
  afterSubmit?: {
    consequence: string
    releasesAgentId?: string | null
    createsAuditTrail?: boolean
    nextStatus?: string | null
  } | null
  agentHandoff?: {
    targetAgentId?: string | null
    sourceTaskId?: string | null
    sourceProjectId?: string | null
    summary: string
    context?: Record<string, unknown> | null
  } | null
  safetyGate?: {
    level: string
    summary: string
    sideEffectAllowed: boolean
    requiresApproval: boolean
    gatedActions?: string[]
  } | null
  disabledReason?: string | null
  nearestValidActions?: Array<{
    action: string
    label: string
    reason?: string | null
    href?: string
  }> | null
  userState?: {
    status?: 'active' | 'read' | 'handled' | 'snoozed' | 'rejected' | 'approved' | 'pending-review' | 'follow-up-created'
    note?: string | null
    snoozedUntil?: string | null
    approvalState?: string | null
    approvalCopy?: string | null
    sideEffectPerformed?: false
  } | null
  occurredAt: string
}

export interface BriefingFeed {
  items: BriefingCard[]
  total: number
  hasMore: boolean
  generatedAt: string
}

export type Mode = 'admin' | 'portal'
export type Flash = { kind: 'ok' | 'error'; message: string } | null
