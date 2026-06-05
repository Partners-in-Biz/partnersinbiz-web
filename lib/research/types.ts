export type ResearchKind =
  | 'competitor'
  | 'market'
  | 'seo'
  | 'audience'
  | 'content'
  | 'ads'
  | 'crm'
  | 'prospect'
  | 'brand'
  | 'product'
  | 'local'
  | 'onboarding'
  | 'internal'
  | 'other'

export type ResearchStatus = 'draft' | 'in_review' | 'verified' | 'used_in_document' | 'archived'
export type ResearchVisibility = 'internal' | 'client_visible'
export type ResearchConfidence = 'low' | 'medium' | 'high'
export type ResearchFindingStatus = 'open' | 'verified' | 'disputed' | 'outdated' | 'used'
export type ResearchRecommendationPriority = 'low' | 'medium' | 'high' | 'urgent'
export type ResearchRecommendationStatus = 'open' | 'accepted' | 'rejected' | 'done'
export type ResearchSourceType = 'url' | 'file' | 'screenshot' | 'quote' | 'dataset' | 'email' | 'note'

export interface ResearchLinked {
  projectId?: string
  campaignId?: string
  seoSprintId?: string
  dealId?: string
  companyId?: string
  contactId?: string
  projectIds?: string[]
  dealIds?: string[]
  companyIds?: string[]
  contactIds?: string[]
  clientOrgIds?: string[]
  socialPostIds?: string[]
  emailThreadIds?: string[]
  supportTicketIds?: string[]
  documentIds?: string[]
}

export interface ResearchFinding {
  id: string
  title: string
  body: string
  confidence: ResearchConfidence
  status: ResearchFindingStatus
  sourceIds: string[]
  tags: string[]
}

export interface ResearchRecommendation {
  id: string
  title: string
  body: string
  priority: ResearchRecommendationPriority
  status: ResearchRecommendationStatus
  sourceIds: string[]
}

export interface ResearchObsidianState {
  exported: boolean
  path?: string
  sourcesPath?: string
  exportedAt?: unknown
  exportedBy?: string
}

export interface ResearchItem {
  id: string
  orgId: string
  title: string
  slug: string
  kind: ResearchKind
  status: ResearchStatus
  visibility: ResearchVisibility
  summary: string
  notesMarkdown: string
  tags: string[]
  linked: ResearchLinked
  findings: ResearchFinding[]
  recommendations: ResearchRecommendation[]
  obsidian: ResearchObsidianState
  createdAt?: unknown
  createdBy: string
  updatedAt?: unknown
  updatedBy: string
  deleted: boolean
}

export interface ResearchSource {
  id: string
  researchItemId: string
  type: ResearchSourceType
  title: string
  url?: string
  excerpt?: string
  mediaUrl?: string
  sourceDate?: string
  publisher?: string
  confidence: ResearchConfidence
  verified: boolean
  rawText?: string
  metadata?: Record<string, unknown>
  createdAt?: unknown
  createdBy: string
  updatedAt?: unknown
  updatedBy: string
  deleted: boolean
}

export type ResearchCommentAnchor =
  | { type: 'item' }
  | { type: 'finding'; id: string }
  | { type: 'recommendation'; id: string }
  | { type: 'source'; id: string }
  | { type: 'text'; text: string; targetId?: string }
  | { type: 'image'; mediaUrl: string; targetId?: string }

export const RESEARCH_KINDS: readonly ResearchKind[] = [
  'competitor',
  'market',
  'seo',
  'audience',
  'content',
  'ads',
  'crm',
  'prospect',
  'brand',
  'product',
  'local',
  'onboarding',
  'internal',
  'other',
] as const

export const RESEARCH_STATUSES: readonly ResearchStatus[] = [
  'draft',
  'in_review',
  'verified',
  'used_in_document',
  'archived',
] as const

export const RESEARCH_VISIBILITIES: readonly ResearchVisibility[] = ['internal', 'client_visible'] as const
export const RESEARCH_CONFIDENCES: readonly ResearchConfidence[] = ['low', 'medium', 'high'] as const
export const RESEARCH_FINDING_STATUSES: readonly ResearchFindingStatus[] = ['open', 'verified', 'disputed', 'outdated', 'used'] as const
export const RESEARCH_RECOMMENDATION_PRIORITIES: readonly ResearchRecommendationPriority[] = ['low', 'medium', 'high', 'urgent'] as const
export const RESEARCH_RECOMMENDATION_STATUSES: readonly ResearchRecommendationStatus[] = ['open', 'accepted', 'rejected', 'done'] as const
export const RESEARCH_SOURCE_TYPES: readonly ResearchSourceType[] = ['url', 'file', 'screenshot', 'quote', 'dataset', 'email', 'note'] as const
