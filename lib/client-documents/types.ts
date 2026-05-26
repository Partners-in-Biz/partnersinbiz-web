export type ClientDocumentType =
  | 'sales_proposal'
  | 'build_spec'
  | 'social_strategy'
  | 'content_campaign_plan'
  | 'geo_seo_strategy'
  | 'research_report'
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
  | ShowcaseDocumentBlockType

export type LegacyDocumentBlockType = Exclude<DocumentBlockType, ShowcaseDocumentBlockType>

export type ShowcaseDocumentBlockType =
  | 'funnel'
  | 'radar'
  | 'quadrant_matrix'
  | 'before_after'
  | 'roadmap_gantt'
  | 'logo_testimonial_proof'
  | 'case_study_result_cards'
  | 'weighted_decision_matrix'

export const LEGACY_DOCUMENT_BLOCK_TYPES = [
  'hero',
  'summary',
  'problem',
  'scope',
  'deliverables',
  'timeline',
  'investment',
  'terms',
  'approval',
  'metrics',
  'risk',
  'table',
  'gallery',
  'callout',
  'rich_text',
  'image',
  'video',
  'embed',
  'link_card',
  'chart',
  'pricing_toggle',
  'faq',
  'comparison',
] as const satisfies readonly LegacyDocumentBlockType[]

export const SHOWCASE_DOCUMENT_BLOCK_TYPES = [
  'funnel',
  'radar',
  'quadrant_matrix',
  'before_after',
  'roadmap_gantt',
  'logo_testimonial_proof',
  'case_study_result_cards',
  'weighted_decision_matrix',
] as const satisfies readonly ShowcaseDocumentBlockType[]

export const CANONICAL_DOCUMENT_BLOCK_TYPES = [
  ...LEGACY_DOCUMENT_BLOCK_TYPES,
  ...SHOWCASE_DOCUMENT_BLOCK_TYPES,
] as const satisfies readonly DocumentBlockType[]

export interface ShowcaseBlockContract<TType extends ShowcaseDocumentBlockType = ShowcaseDocumentBlockType> {
  type: TType
  payloadKey: string
  requiredFields: string[]
  backwardCompatible: true
}

export interface FunnelBlockContent {
  eyebrow?: string
  headline?: string
  description?: string
  stages: Array<{
    id: string
    label: string
    value?: number
    description?: string
    conversionRate?: number
    color?: string
  }>
}

export interface RadarBlockContent {
  eyebrow?: string
  headline?: string
  description?: string
  axes: Array<{
    id: string
    label: string
    value: number
    max?: number
    benchmark?: number
    color?: string
  }>
}

export interface QuadrantMatrixBlockContent {
  eyebrow?: string
  headline?: string
  description?: string
  xAxis: { label: string; minLabel?: string; maxLabel?: string }
  yAxis: { label: string; minLabel?: string; maxLabel?: string }
  items: Array<{
    id: string
    label: string
    x: number
    y: number
    description?: string
    size?: number
    color?: string
  }>
}

export interface BeforeAfterBlockContent {
  eyebrow?: string
  headline?: string
  description?: string
  pairs: Array<{
    id: string
    label: string
    before: string
    after: string
    evidence?: string
    mediaBeforeUrl?: string
    mediaAfterUrl?: string
  }>
}

export interface RoadmapGanttBlockContent {
  eyebrow?: string
  headline?: string
  description?: string
  items: Array<{
    id: string
    label: string
    start: string
    end: string
    lane?: string
    status?: 'planned' | 'in_progress' | 'complete' | 'at_risk' | 'blocked'
    dependsOn?: string[]
    owner?: string
  }>
  milestones?: Array<{ id: string; label: string; date: string }>
}

export interface LogoTestimonialProofBlockContent {
  eyebrow?: string
  headline?: string
  description?: string
  proof: Array<{
    id: string
    kind: 'logo' | 'testimonial' | 'credential' | 'stat'
    logoUrl?: string
    organisationName?: string
    quote?: string
    personName?: string
    personRole?: string
    metricLabel?: string
    metricValue?: string
    href?: string
  }>
}

export interface CaseStudyResultCardsBlockContent {
  eyebrow?: string
  headline?: string
  description?: string
  cards: Array<{
    id: string
    title: string
    result: string
    narrative?: string
    baseline?: string
    timeframe?: string
    imageUrl?: string
    href?: string
  }>
}

export interface WeightedDecisionMatrixBlockContent {
  eyebrow?: string
  headline?: string
  description?: string
  criteria: Array<{ id: string; label: string; weight: number; description?: string }>
  options: Array<{
    id: string
    label: string
    scores: Record<string, number>
    summary?: string
    recommended?: boolean
  }>
}

export interface ShowcaseBlockContentByType {
  funnel: FunnelBlockContent
  radar: RadarBlockContent
  quadrant_matrix: QuadrantMatrixBlockContent
  before_after: BeforeAfterBlockContent
  roadmap_gantt: RoadmapGanttBlockContent
  logo_testimonial_proof: LogoTestimonialProofBlockContent
  case_study_result_cards: CaseStudyResultCardsBlockContent
  weighted_decision_matrix: WeightedDecisionMatrixBlockContent
}

export const CANONICAL_SHOWCASE_BLOCK_CONTRACTS = {
  funnel: { type: 'funnel', payloadKey: 'stages', requiredFields: ['stages'], backwardCompatible: true },
  radar: { type: 'radar', payloadKey: 'axes', requiredFields: ['axes'], backwardCompatible: true },
  quadrant_matrix: {
    type: 'quadrant_matrix',
    payloadKey: 'items',
    requiredFields: ['xAxis', 'yAxis', 'items'],
    backwardCompatible: true,
  },
  before_after: { type: 'before_after', payloadKey: 'pairs', requiredFields: ['pairs'], backwardCompatible: true },
  roadmap_gantt: { type: 'roadmap_gantt', payloadKey: 'items', requiredFields: ['items'], backwardCompatible: true },
  logo_testimonial_proof: {
    type: 'logo_testimonial_proof',
    payloadKey: 'proof',
    requiredFields: ['proof'],
    backwardCompatible: true,
  },
  case_study_result_cards: {
    type: 'case_study_result_cards',
    payloadKey: 'cards',
    requiredFields: ['cards'],
    backwardCompatible: true,
  },
  weighted_decision_matrix: {
    type: 'weighted_decision_matrix',
    payloadKey: 'criteria',
    requiredFields: ['criteria', 'options'],
    backwardCompatible: true,
  },
} as const satisfies Record<ShowcaseDocumentBlockType, ShowcaseBlockContract>

export interface ClientDocumentLinkSet {
  projectId?: string
  campaignId?: string
  reportId?: string
  dealId?: string
  seoSprintId?: string
  geoWorkspaceId?: string
  geoAuditId?: string
  geoTaskIds?: string[]
  researchItemIds?: string[]
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

export type ClientDocumentTemplatePurpose =
  | 'sales_proposal'
  | 'implementation_spec'
  | 'strategy_plan'
  | 'content_plan'
  | 'research_presentation'
  | 'performance_report'
  | 'launch_acceptance'
  | 'scope_change_approval'
  | 'legacy_safe_fallback'

export type ClientDocumentTaskFanoutMode = 'none' | 'manual' | 'approval_gated' | 'automatic_after_approval'

export interface ClientDocumentTemplateContract {
  purpose: ClientDocumentTemplatePurpose
  recommendedBlockTypes: DocumentBlockType[]
  approvalMode: ApprovalMode
  taskFanout: ClientDocumentTaskFanoutMode
  aiPromptKey: string
}

export interface ClientDocumentTemplatePickerMetadata {
  description: string
  bestFor: string
  decides: string
  helpText: string
}

export interface ClientDocumentTemplate {
  id: string
  type: ClientDocumentType
  label: string
  approvalMode: ApprovalMode
  clientPermissions: ClientDocumentPermissions
  requiredBlockTypes: DocumentBlockType[]
  defaultBlocks: DocumentBlock[]
  contract: ClientDocumentTemplateContract
  picker: ClientDocumentTemplatePickerMetadata
  agentWorkflowTasks?: ClientDocumentAgentWorkflowTask[]
}

export interface ClientDocumentAgentWorkflowTask {
  key: string
  title: string
  description: string
  sectionId: string
  assigneeAgentId?: string
  dependsOn?: string[]
  priority?: 'urgent' | 'high' | 'medium' | 'normal' | 'low'
  labels?: string[]
  reviewerAgentId?: string | null
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  requiredCapability?: string | null
  expectedArtifacts?: string[]
  sourceResearchItemId?: string | null
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
