/**
 * Social Media Provider Abstraction Layer — Type Definitions
 *
 * Defines the unified interface all social platform providers must implement,
 * along with platform constraint configurations and shared types.
 */
import { Timestamp } from 'firebase-admin/firestore'

// ---------------------------------------------------------------------------
// Platform enum — all supported platforms (current + planned)
// ---------------------------------------------------------------------------

export type SocialPlatformType =
  | 'twitter'
  | 'linkedin'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'pinterest'
  | 'reddit'
  | 'youtube'
  | 'threads'
  | 'bluesky'
  | 'mastodon'
  | 'dribbble'

/** Platforms currently active with provider implementations */
export const ACTIVE_PLATFORMS: SocialPlatformType[] = [
  'twitter', 'linkedin', 'facebook', 'instagram', 'reddit',
  'tiktok', 'pinterest', 'bluesky', 'threads', 'youtube', 'mastodon', 'dribbble',
]

// ---------------------------------------------------------------------------
// Account types
// ---------------------------------------------------------------------------

export type AccountType = 'personal' | 'business' | 'page' | 'group'
export type AccountStatus = 'active' | 'token_expired' | 'disconnected' | 'rate_limited'
export type AccountScope = 'org' | 'personal'

export interface SocialAccount {
  id?: string
  orgId: string
  platform: SocialPlatformType
  platformAccountId: string
  displayName: string
  username: string
  avatarUrl: string
  profileUrl: string
  accountType: AccountType
  accountScope?: AccountScope
  ownerUid?: string | null
  status: AccountStatus
  scopes: string[]
  encryptedTokens: EncryptedTokenBlock
  platformMeta: Record<string, unknown>
  connectedBy: string
  connectedAt: Timestamp
  lastTokenRefresh: Timestamp | null
  lastUsed: Timestamp | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface EncryptedTokenBlock {
  accessToken: string
  refreshToken: string | null
  tokenType: string
  expiresAt: Timestamp | null
  iv: string
  tag: string
}

// ---------------------------------------------------------------------------
// Post types (enhanced)
// ---------------------------------------------------------------------------

export type PostStatus =
  | 'draft'
  | 'qa_review'
  | 'client_review'
  | 'regenerating'
  | 'pending_approval'
  | 'approved'
  | 'vaulted'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'partially_published'
  | 'failed'
  | 'cancelled'

export type PostSource = 'ui' | 'api' | 'ai_agent' | 'rss' | 'bulk_import'

export type DeliveryMode = 'auto_publish' | 'download_only' | 'both'

export type RejectionStage = 'qa' | 'client'

export interface RejectionRecord {
  stage: RejectionStage
  reason: string
  rejectedBy: string
  rejectedByName: string
  rejectedAt: Timestamp
  resolved: boolean
}

export interface ApprovalState {
  qaApprovedBy: string | null
  qaApprovedAt: Timestamp | null
  clientApprovedBy: string | null
  clientApprovedAt: Timestamp | null
  rejectionCount: number
  regenerationCount: number
  lastRejectionStage: RejectionStage | null
  lastRejectedAt: Timestamp | null
  history: RejectionRecord[]
}

export interface PlatformOverride {
  text?: string
  title?: string
  subreddit?: string
  boardId?: string
  altText?: string
}

export interface PostMediaAttachment {
  mediaId: string
  type: 'image' | 'video' | 'gif' | 'carousel'
  url: string
  thumbnailUrl: string
  width: number
  height: number
  duration?: number
  altText: string
  order: number
}

export interface PlatformResult {
  platform: SocialPlatformType
  status: 'pending' | 'published' | 'failed'
  platformPostId: string | null
  platformPostUrl: string | null
  publishedAt: Timestamp | null
  error: string | null
  retryCount: number
}

export type CommentKind = 'note' | 'qa_rejection' | 'client_rejection' | 'agent_handoff'

export interface PostComment {
  id: string
  userId: string
  userName: string
  text: string
  createdAt: Timestamp
  userRole?: 'admin' | 'client' | 'ai'
  kind?: CommentKind
  agentPickedUp?: boolean
  agentPickedUpAt?: Timestamp | null
}

export interface EnhancedSocialPost {
  id?: string
  orgId: string
  content: {
    text: string
    platformOverrides: Record<string, PlatformOverride>
  }
  media: PostMediaAttachment[]
  platforms: SocialPlatformType[]
  accountIds: string[]
  status: PostStatus
  scheduledAt: Timestamp | null
  publishedAt: Timestamp | null
  platformResults: Record<string, PlatformResult>
  hashtags: string[]
  labels: string[]
  campaign: string | null
  createdBy: string
  assignedTo: string | null
  approvedBy: string | null
  approvedAt: Timestamp | null
  requiresApproval: boolean
  deliveryMode: DeliveryMode
  approval: ApprovalState
  originalContent: string | null
  comments: PostComment[]
  source: PostSource
  // Legacy compatibility
  threadParts: string[]
  category: string
  tags: string[]
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ---------------------------------------------------------------------------
// Media types
// ---------------------------------------------------------------------------

export type MediaType = 'image' | 'video' | 'gif'
export type MediaStatus = 'uploading' | 'processing' | 'ready' | 'failed'

export interface SocialMedia {
  id?: string
  orgId: string
  originalUrl: string
  originalFilename: string
  originalMimeType: string
  originalSize: number
  status: MediaStatus
  variants: Record<string, MediaVariant>
  thumbnailUrl: string
  type: MediaType
  width: number
  height: number
  duration: number | null
  altText: string
  storagePath: string | null
  usedInPosts: string[]
  uploadedBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface MediaVariant {
  url: string
  width: number
  height: number
  size: number
  mimeType: string
}

// ---------------------------------------------------------------------------
// Queue types
// ---------------------------------------------------------------------------

export type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface QueueEntry {
  id?: string
  orgId: string
  postId: string
  scheduledAt: Timestamp
  status: QueueStatus
  priority: number
  attempts: number
  maxAttempts: number
  lastAttemptAt: Timestamp | null
  nextRetryAt: Timestamp | null
  backoffSeconds: number
  lockedBy: string | null
  lockedAt: Timestamp | null
  startedAt: Timestamp | null
  completedAt: Timestamp | null
  error: string | null
  createdAt: Timestamp
}

// ---------------------------------------------------------------------------
// Audit log types
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'post.created'
  | 'post.updated'
  | 'post.deleted'
  | 'post.published'
  | 'post.failed'
  | 'post.scheduled'
  | 'post.cancelled'
  | 'post.approved'
  | 'post.rejected'
  | 'post.submitted'
  | 'post.qa_approved'
  | 'post.qa_rejected'
  | 'post.client_approved'
  | 'post.client_rejected'
  | 'post.regenerated'
  | 'post.vaulted'
  | 'post.downloaded'
  | 'account.connected'
  | 'account.disconnected'
  | 'account.token_refreshed'
  | 'media.uploaded'
  | 'media.deleted'

export type AuditEntityType = 'post' | 'account' | 'media' | 'rss' | 'webhook'

export interface AuditLogEntry {
  id?: string
  orgId: string
  action: AuditAction
  entityType: AuditEntityType
  entityId: string
  performedBy: string
  performedByRole: 'admin' | 'client' | 'ai' | 'system'
  details: Record<string, unknown>
  ip: string | null
  createdAt: Timestamp
}

// ---------------------------------------------------------------------------
// Provider interface types
// ---------------------------------------------------------------------------

export interface PublishResult {
  platformPostId: string
  platformPostUrl?: string
}

export interface ProfileInfo {
  platformAccountId: string
  displayName: string
  username: string
  avatarUrl: string
  profileUrl: string
  accountType: AccountType
  followerCount?: number
  followingCount?: number
  meta?: Record<string, unknown>
}

export interface AnalyticsData {
  impressions: number
  reach: number
  engagements: number
  likes: number
  comments: number
  shares: number
  saves: number
  clicks: number
}

// ---------------------------------------------------------------------------
// Platform constraints
// ---------------------------------------------------------------------------

export interface MediaConstraint {
  maxSizeMB: number
  allowedTypes: string[]
  maxWidth?: number
  maxHeight?: number
  minWidth?: number
  minHeight?: number
  aspectRatios?: string[]
  maxDurationSeconds?: number
}

export interface PlatformConstraints {
  platform: SocialPlatformType
  maxTextLength: number
  maxHashtags: number | null
  maxMediaPerPost: number
  supportsThreads: boolean
  supportsVideo: boolean
  supportsCarousel: boolean
  supportsAltText: boolean
  maxThreadParts: number | null
  maxThreadPartLength: number | null
  linkCountsAgainstLimit: boolean
  linkReservedChars: number
  image: MediaConstraint
  video: MediaConstraint | null
}

// ---------------------------------------------------------------------------
// Validation types
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string
  message: string
  platform?: SocialPlatformType
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}
