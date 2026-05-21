export type ClientDocumentType =
  | 'sales_proposal'
  | 'build_spec'
  | 'social_strategy'
  | 'content_campaign_plan'
  | 'geo_seo_strategy'
  | 'monthly_report'
  | 'launch_signoff'
  | 'change_request'

export type ClientDocumentStatus =
  | 'internal_draft'
  | 'internal_review'
  | 'client_review'
  | 'changes_requested'
  | 'approved'
  | 'accepted'
  | 'archived'

export type ApprovalMode = 'none' | 'operational' | 'formal_acceptance'

export type DocumentActorType = 'user' | 'agent' | 'system'

export type DocumentParticipantRole = 'admin' | 'client' | 'agent'

export type DocumentBlockType =
  | 'hero'
  | 'summary'
  | 'problem'
  | 'scope'
  | 'deliverables'
  | 'timeline'
  | 'investment'
  | 'terms'
  | 'approval'
  | 'metrics'
  | 'risk'
  | 'table'
  | 'gallery'
  | 'callout'
  | 'rich_text'
  | 'image'
  | 'video'
  | 'embed'
  | 'link_card'
  | 'chart'
  | 'pricing_toggle'
  | 'faq'
  | 'comparison'

export interface ClientDocumentLinkSet {
  projectId?: string
  campaignId?: string
  reportId?: string
  dealId?: string
  seoSprintId?: string
  geoWorkspaceId?: string
  geoAuditId?: string
  geoTaskIds?: string[]
  socialPostIds?: string[]
  invoiceId?: string
}

export interface ClientDocumentPermissions {
  canComment: boolean
  canSuggest: boolean
  canDirectEdit: boolean
  canApprove: boolean
}

export interface DocumentAssumption {
  id: string
  text: string
  severity: 'info' | 'needs_review' | 'blocks_publish'
  status: 'open' | 'resolved'
  blockId?: string
  createdBy: string
  createdAt?: unknown
  resolvedBy?: string
  resolvedAt?: unknown
}

export interface DocumentTheme {
  brandName?: string
  logoUrl?: string
  palette: {
    bg: string
    text: string
    accent: string
    muted?: string
  }
  typography: {
    heading: string
    body: string
  }
}

export interface DocumentBlock {
  id: string
  type: DocumentBlockType
  title?: string
  content: unknown
  required: boolean
  locked?: boolean
  clientEditable?: boolean
  display: {
    variant?: string
    accent?: string
    motion?: 'none' | 'reveal' | 'sticky' | 'counter' | 'timeline'
  }
}

export interface ClientDocument {
  id: string
  orgId?: string
  title: string
  type: ClientDocumentType
  templateId: string
  status: ClientDocumentStatus
  linked: ClientDocumentLinkSet
  currentVersionId: string
  latestPublishedVersionId?: string
  approvalMode: ApprovalMode
  clientPermissions: ClientDocumentPermissions
  assumptions: DocumentAssumption[]
  shareToken: string
  shareEnabled: boolean
  /** Edit-share token (separate from shareToken). Allows code-gated comment/edit access. */
  editShareToken?: string
  /** Whether the edit share link is active. */
  editShareEnabled: boolean
  /** Six-character access code for the edit-share. Required to pass code gate. */
  editAccessCode?: string
  /** Last time the access code was generated/rotated. */
  editAccessCodeRotatedAt?: unknown
  createdAt?: unknown
  createdBy: string
  createdByType: DocumentActorType
  updatedAt?: unknown
  updatedBy: string
  updatedByType: DocumentActorType
  deleted: boolean
}

export interface ClientDocumentVersion {
  id: string
  documentId: string
  versionNumber: number
  status: 'draft' | 'published' | 'approved' | 'superseded'
  blocks: DocumentBlock[]
  theme: DocumentTheme
  createdAt?: unknown
  createdBy: string
  createdByType: DocumentActorType
  changeSummary?: string
}

export interface DocumentCommentReply {
  id: string
  text: string
  userId: string
  userName: string
  userRole: DocumentParticipantRole
  createdAt?: unknown
}

export interface DocumentComment {
  id: string
  documentId: string
  versionId: string
  blockId?: string
  text: string
  anchor?: { type: 'text'; text: string; offset?: number } | { type: 'image'; mediaUrl: string }
  userId: string
  userName: string
  userRole: DocumentParticipantRole
  status: 'open' | 'resolved'
  agentPickedUp: boolean
  createdAt?: unknown
  resolvedAt?: unknown
  resolvedBy?: string
  replies?: DocumentCommentReply[]
}

export interface DocumentSuggestion {
  id: string
  documentId: string
  versionId: string
  blockId: string
  kind: 'replace_text' | 'insert_text' | 'delete_text' | 'replace_block'
  original: unknown
  proposed: unknown
  status: 'open' | 'accepted' | 'rejected'
  createdBy: string
  createdAt?: unknown
  resolvedBy?: string
  resolvedAt?: unknown
}

export interface DocumentApproval {
  id: string
  documentId: string
  versionId: string
  mode: ApprovalMode
  actorId: string
  actorName: string
  actorRole: DocumentParticipantRole | 'ai'
  companyName?: string
  typedName?: string
  checkboxText?: string
  termsSnapshot?: unknown
  investmentSnapshot?: unknown
  ip?: string
  userAgent?: string
  createdAt?: unknown
}

export interface ClientDocumentTemplate {
  id: string
  type: ClientDocumentType
  label: string
  approvalMode: ApprovalMode
  clientPermissions: ClientDocumentPermissions
  requiredBlockTypes: DocumentBlockType[]
  defaultBlocks: DocumentBlock[]
  agentWorkflowTasks?: ClientDocumentAgentWorkflowTask[]
}

export interface ClientDocumentAgentWorkflowTask {
  key: string
  title: string
  description: string
  sectionId: string
  assigneeAgentId?: 'pip' | 'theo' | 'maya' | 'sage' | 'nora'
  dependsOn?: string[]
  priority?: 'urgent' | 'high' | 'medium' | 'normal' | 'low'
  labels?: string[]
}

export interface MagicLink {
  id: string                      // random hex, also the token
  email: string                   // lowercased
  redirectUrl?: string
  context?: {
    type: 'edit_share'
    documentId: string
    editShareToken: string
  }
  used: boolean
  createdAt?: unknown
  expiresAt?: unknown
}

export interface DocumentAccessLog {
  id: string
  type: 'view' | 'code_entered' | 'code_failed' | 'auth_success' | 'auth_failed'
  email?: string
  ip?: string
  userAgent?: string
  createdAt?: unknown
}
