export type ActorType = 'user' | 'agent' | 'system'

export interface YouTubeApprovalPolicy {
  requireInternalBriefApproval: boolean
  requireClientBriefApproval: boolean
  requireClientScriptApproval: boolean
  requireClientDraftApproval: boolean
  requireClientThumbnailApproval: boolean
  requireClientPublishConfirmation: boolean
  requireInternalPublishApproval: boolean
}

export interface YouTubePublishingPolicy {
  allowedModes: Array<'manual_handoff' | 'private_api_upload' | 'scheduled_api_publish'>
  defaultVisibility: 'private' | 'unlisted' | 'public'
  privateFirstRequired: boolean
  publicPublishRequiresAdmin: boolean
  publicPublishRequiresClientConfirmation: boolean
}

export type YouTubeConnectedAccountStatus = 'not_connected' | 'connected' | 'needs_reauth' | 'revoked' | 'blocked'
export type YouTubeApiProjectStatus =
  | 'unknown'
  | 'unverified_private_only'
  | 'verified'
  | 'audit_required'
  | 'quota_limited'
  | 'blocked'
export type YouTubePublishingReadinessLevel =
  | 'not_ready'
  | 'manual_only'
  | 'private_upload_ready'
  | 'scheduled_publish_ready'
  | 'blocked'

export interface YouTubePublishingReadiness {
  accountStatus: YouTubeConnectedAccountStatus
  apiProjectStatus: YouTubeApiProjectStatus
  readiness: YouTubePublishingReadinessLevel
  defaultUploadPrivacy: YouTubePublishingPolicy['defaultVisibility']
  allowedModes: YouTubePublishingPolicy['allowedModes']
  quotaDailyLimit?: number
  quotaUnitsRemaining?: number
  lastCheckedAt?: unknown
  checkedBy?: string
  checkedByType?: ActorType
  notes?: string
}

export type YouTubeChannelStatus = 'setup' | 'strategy' | 'active' | 'paused' | 'blocked' | 'archived'
export type YouTubeSeriesFormat = 'shorts' | 'long_form' | 'podcast' | 'case_study' | 'tutorial' | 'ads' | 'mixed'
export type YouTubeSeriesCadence = 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'campaign' | 'ad_hoc'
export type YouTubeSeriesStatus = 'active' | 'paused' | 'complete' | 'archived'
export type YouTubeVideoType =
  | 'short'
  | 'long_form'
  | 'clip_pack'
  | 'podcast_episode'
  | 'webinar_cutdown'
  | 'testimonial'
  | 'case_study'
  | 'tutorial'
  | 'product_demo'
  | 'ad_creative'
  | 'community_update'
export type YouTubeVideoStatus =
  | 'intake'
  | 'briefing'
  | 'production'
  | 'internal_review'
  | 'client_review'
  | 'changes_requested'
  | 'publish_ready'
  | 'scheduled'
  | 'live'
  | 'blocked'
  | 'archived'
export type YouTubeSourceType = 'raw_footage' | 'source_url' | 'transcript' | 'research' | 'client_request' | 'manual'
export type YouTubeSourceAssetType =
  | 'raw_footage'
  | 'source_url'
  | 'transcript'
  | 'thumbnail'
  | 'audio'
  | 'caption'
  | 'broll'
  | 'image'
  | 'document'
  | 'rendered_video'
export type YouTubeSourceAssetStatus = 'intake' | 'processing' | 'ready' | 'needs_rights_review' | 'blocked' | 'archived'
export type YouTubeSourceAssetMediaFormat = 'horizontal' | 'vertical' | 'square' | 'audio' | 'document' | 'unknown'
export type YouTubeClipCandidateStatus = 'suggested' | 'selected' | 'rejected' | 'needs_review' | 'exported' | 'archived'
export type YouTubeClipTargetFormat = 'vertical_short' | 'square_short' | 'long_form_excerpt' | 'ad_cutdown' | 'testimonial_cut'
export type YouTubeProductionDraftType = 'brief' | 'outline' | 'script' | 'storyboard' | 'shot_list' | 'voiceover' | 'edit_notes'
export type YouTubeProductionDraftStatus =
  | 'draft'
  | 'internal_review'
  | 'client_review'
  | 'approved'
  | 'changes_requested'
  | 'blocked'
  | 'archived'
export type YouTubeRenderJobType = 'full_video' | 'short_clip' | 'clip_pack' | 'trailer' | 'thumbnail_motion'
export type YouTubeRenderTargetFormat = 'horizontal_16_9' | 'vertical_9_16' | 'square_1_1'
export type YouTubeRenderJobStatus =
  | 'planning'
  | 'ready_for_edit'
  | 'rendering'
  | 'rendered'
  | 'qa_review'
  | 'approved'
  | 'blocked'
  | 'cancelled'
export type YouTubeGateStatus = 'pass' | 'warning' | 'block' | 'not_applicable'
export type YouTubeProductionSkillKey =
  | 'youtube-channel-strategy'
  | 'youtube-series-planner'
  | 'youtube-video-brief'
  | 'youtube-research-to-video'
  | 'youtube-script-writer'
  | 'youtube-clip-finder'
  | 'youtube-shorts-packager'
  | 'youtube-thumbnail-brief'
  | 'youtube-title-metadata'
  | 'youtube-captions-chapters'
  | 'youtube-ai-disclosure-check'
  | 'youtube-rights-check'
  | 'youtube-publish-readiness'
  | 'youtube-analytics-import'
  | 'youtube-retention-review'
  | 'youtube-next-video-brief'
export type YouTubeAgentJobStatus = 'queued' | 'running' | 'waiting_for_review' | 'completed' | 'failed' | 'cancelled'
export type YouTubeAgentJobPriority = 'low' | 'normal' | 'high' | 'urgent'
export type YouTubeAgentJobVisibility = 'internal' | 'client_visible'
export type YouTubeProductionSkillFamily = 'strategy' | 'production' | 'packaging' | 'readiness' | 'analytics'
export type YouTubeAnalyticsSource = 'youtube_analytics_api' | 'youtube_reporting_api' | 'manual_import'
export type YouTubeAnalyticsFreshness = 'fresh' | 'delayed' | 'partial' | 'estimated'
export type YouTubeAnalyticsRecommendationType =
  | 'retitle'
  | 'thumbnail_test'
  | 'shorts_pack'
  | 'follow_up_video'
  | 'series_change'
  | 'cadence_change'
export type YouTubeAnalyticsRecommendationConfidence = 'low' | 'medium' | 'high'
export type YouTubeAnalyticsRecommendationStatus = 'suggested' | 'accepted' | 'rejected' | 'converted_to_task'
export type YouTubeReleaseMode = YouTubePublishingPolicy['allowedModes'][number]
export type YouTubeReleasePlanStatus = 'draft' | 'ready' | 'scheduled' | 'published' | 'blocked' | 'cancelled'

export interface YouTubePublishAuditEvent {
  event: 'readiness_blocked' | 'upload_started' | 'upload_succeeded' | 'upload_failed' | 'manual_handoff_required'
  message: string
  at?: unknown
  actorId?: string
  actorType?: ActorType
  externalYouTubeVideoId?: string
  retryable?: boolean
  errorType?: string
  quotaUnits?: number
}

export interface YouTubeAnalyticsMetrics {
  views?: number
  watchTimeMinutes?: number
  averageViewDurationSeconds?: number
  averageViewPercentage?: number
  impressions?: number
  impressionsCtr?: number
  subscribersGained?: number
  subscribersLost?: number
  likes?: number
  comments?: number
  shares?: number
}

export interface YouTubeAnalyticsRecommendation {
  type: YouTubeAnalyticsRecommendationType
  summary: string
  confidence: YouTubeAnalyticsRecommendationConfidence
  status: YouTubeAnalyticsRecommendationStatus
  taskId?: string
  notes?: string
}

export interface YouTubeGateCheck {
  status: YouTubeGateStatus
  message: string
  checkedBy?: string
  checkedByType?: ActorType
  checkedAt?: unknown
}

export type YouTubeMediaStorageProvider = 'firebase_storage' | 'google_drive' | 'external_url' | 'local_sync'
export type YouTubeMediaProcessingStatus = 'not_requested' | 'queued' | 'running' | 'completed' | 'failed' | 'blocked'
export type YouTubeMediaBudgetStatus = 'within_budget' | 'near_limit' | 'over_limit' | 'blocked'

export interface YouTubeMediaStorageRecord {
  provider?: YouTubeMediaStorageProvider
  artifactId?: string
  driveFileId?: string
  storagePath?: string
  originalFilename?: string
  mimeType?: string
  sizeBytes?: number
  checksumSha256?: string
}

export interface YouTubeMediaProcessingHook {
  status: YouTubeMediaProcessingStatus
  provider?: string
  jobId?: string
  requestedAt?: unknown
  completedAt?: unknown
  outputAssetId?: string
  outputAssetIds?: string[]
  targetStoragePath?: string
  language?: string
  format?: string
  errorCode?: string
  errorMessage?: string
}

export interface YouTubeMediaCostControls {
  currency?: string
  maxEstimatedCostCents?: number
  estimatedCostCents?: number
  actualCostCents?: number
  quotaUnitsEstimated?: number
  quotaUnitsUsed?: number
  budgetStatus?: YouTubeMediaBudgetStatus
}

export interface YouTubeMediaErrorState {
  code?: string
  message?: string
  retryable?: boolean
  failedAt?: unknown
}

export interface YouTubeMediaProcessingPlan {
  transcode?: YouTubeMediaProcessingHook
  proxy?: YouTubeMediaProcessingHook
  transcript?: YouTubeMediaProcessingHook
  captions?: YouTubeMediaProcessingHook
  thumbnails?: YouTubeMediaProcessingHook
}

export interface YouTubeRenderEngineIntegration {
  provider?: string
  jobId?: string
  status?: YouTubeMediaProcessingStatus
  requestedAt?: unknown
  completedAt?: unknown
  webhookUrl?: string
  requestId?: string
}

export interface YouTubeChannelWorkspace {
  id?: string
  orgId: string
  title: string
  youtubeChannelId?: string
  youtubeHandle?: string
  status: YouTubeChannelStatus
  connectedAccountId?: string
  strategyDocumentId?: string
  publishingReadiness?: YouTubePublishingReadiness
  defaultApprovalPolicy: YouTubeApprovalPolicy
  defaultPublishingPolicy: YouTubePublishingPolicy
  contentPillars: string[]
  audienceNotes?: string
  avoidTopics: string[]
  aiDisclosureDefaults: { syntheticMediaLikely: boolean; notes?: string }
  internalNotes?: string
  clientNotes?: string
  visibility?: { showInClientPortal?: boolean; showAnalytics?: boolean }
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

export interface YouTubeSeries {
  id?: string
  orgId: string
  channelWorkspaceId: string
  name: string
  objective?: string
  audience?: string
  format: YouTubeSeriesFormat
  cadence: YouTubeSeriesCadence
  targetDurationSeconds?: number
  episodeTemplate: {
    hook?: string
    sections: Array<{ label: string; targetSeconds?: number; notes?: string }>
    outro?: string
  }
  styleGuide: {
    visualNotes?: string
    thumbnailNotes?: string
    captionNotes?: string
    introOutroRules?: string
  }
  season?: string
  status: YouTubeSeriesStatus
  deleted: boolean
}

export interface YouTubeVideoProject {
  id?: string
  orgId: string
  channelWorkspaceId: string
  seriesId?: string
  title: string
  workingTitle?: string
  videoType: YouTubeVideoType
  status: YouTubeVideoStatus
  objective: string
  targetAudience?: string
  targetDurationSeconds?: number
  source: {
    intakeType: YouTubeSourceType
    researchItemId?: string
    campaignId?: string
    projectId?: string
    sourceUrl?: string
    transcriptAssetId?: string
  }
  linked: {
    projectId?: string
    taskIds?: string[]
    documentIds?: string[]
    campaignId?: string
    socialPostIds?: string[]
  }
  approvalPolicy: YouTubeApprovalPolicy
  publishPacketId?: string
  youtubeVideoId?: string
  scheduledAt?: unknown
  publishedAt?: unknown
  clientReview?: {
    status?: 'not_requested' | 'requested' | 'approved' | 'changes_requested' | 'rejected'
    notes?: string
    decidedAt?: unknown
    decidedBy?: string
  }
  internalNotes?: string
  clientNotes?: string
  visibility?: { showInClientPortal?: boolean; showAnalytics?: boolean; showPublishingPacket?: boolean }
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

export interface YouTubePublishingPacket {
  id?: string
  orgId: string
  channelWorkspaceId: string
  videoProjectId: string
  versionNumber: number
  supersedesPacketId?: string
  status: 'draft' | 'internal_review' | 'client_review' | 'approved' | 'blocked' | 'published'
  titleOptions: Array<{ text: string; rationale?: string; selected?: boolean }>
  description?: string
  tags: string[]
  chapters: Array<{ startSeconds: number; title: string }>
  thumbnailAssetId?: string
  captionAssetId?: string
  videoAssetId?: string
  visibility: 'private' | 'unlisted' | 'public'
  publishAt?: unknown
  selfDeclaredMadeForKids?: boolean
  containsSyntheticMedia?: boolean
  aiDisclosureNotes?: string
  checks: {
    rights: YouTubeGateCheck
    aiDisclosure: YouTubeGateCheck
    madeForKids: YouTubeGateCheck
    metadata: YouTubeGateCheck
    thumbnail: YouTubeGateCheck
    captions: YouTubeGateCheck
    approval: YouTubeGateCheck
    connectedAccount: YouTubeGateCheck
  }
  approvedBy?: string
  approvedAt?: unknown
  approvedSnapshotHash?: string
  deleted: boolean
}

export interface YouTubeSourceAsset {
  id?: string
  orgId: string
  channelWorkspaceId: string
  videoProjectId?: string
  seriesId?: string
  title: string
  description?: string
  assetType: YouTubeSourceAssetType
  status: YouTubeSourceAssetStatus
  durationSeconds?: number
  mediaFormat: YouTubeSourceAssetMediaFormat
  sourceUrl?: string
  storagePath?: string
  storage?: YouTubeMediaStorageRecord
  processing?: YouTubeMediaProcessingPlan
  costControls?: YouTubeMediaCostControls
  error?: YouTubeMediaErrorState
  transcriptText?: string
  transcriptAssetId?: string
  rights?: {
    status?: 'unknown' | 'cleared' | 'needs_review' | 'blocked'
    owner?: string
    license?: string
    notes?: string
  }
  visibility?: { showInClientPortal?: boolean; showTranscriptInPortal?: boolean }
  internalNotes?: string
  clientNotes?: string
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

export interface YouTubeClipCandidate {
  id?: string
  orgId: string
  channelWorkspaceId: string
  videoProjectId?: string
  sourceAssetId: string
  title: string
  summary?: string
  startSeconds: number
  endSeconds: number
  targetFormat: YouTubeClipTargetFormat
  status: YouTubeClipCandidateStatus
  score?: number
  hook?: string
  rationale?: string
  transcriptExcerpt?: string
  checks: {
    rights: YouTubeGateCheck
    aiDisclosure: YouTubeGateCheck
  }
  visibility?: { showInClientPortal?: boolean }
  internalNotes?: string
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

export interface YouTubeProductionDraftScene {
  label: string
  summary?: string
  targetSeconds?: number
  voiceover?: string
  visualNotes?: string
  onScreenText?: string
  sourceAssetIds?: string[]
  clipCandidateIds?: string[]
}

export interface YouTubeProductionDraft {
  id?: string
  orgId: string
  channelWorkspaceId: string
  videoProjectId: string
  title: string
  draftType: YouTubeProductionDraftType
  status: YouTubeProductionDraftStatus
  versionNumber: number
  summary?: string
  hook?: string
  outline: string[]
  scriptText?: string
  sourceAssetIds: string[]
  clipCandidateIds: string[]
  scenes: YouTubeProductionDraftScene[]
  checks: {
    claims: YouTubeGateCheck
    brand: YouTubeGateCheck
    sourceEvidence: YouTubeGateCheck
    clientApproval: YouTubeGateCheck
  }
  visibility?: { showInClientPortal?: boolean; showScriptInPortal?: boolean; showScenesInPortal?: boolean }
  internalNotes?: string
  clientNotes?: string
  approvedBy?: string
  approvedAt?: unknown
  approvedSnapshotHash?: string
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

export interface YouTubeRenderTimelineScene {
  label: string
  summary?: string
  startSeconds?: number
  endSeconds?: number
  sourceAssetId?: string
  clipCandidateId?: string
  voiceover?: string
  onScreenText?: string
  editNotes?: string
}

export interface YouTubeRenderOutput {
  previewUrl?: string
  downloadUrl?: string
  storagePath?: string
  storage?: YouTubeMediaStorageRecord
  assetId?: string
  youtubeVideoId?: string
  durationSeconds?: number
  renderPreset?: string
}

export interface YouTubeRenderJob {
  id?: string
  orgId: string
  channelWorkspaceId: string
  videoProjectId: string
  productionDraftId?: string
  title: string
  renderType: YouTubeRenderJobType
  targetFormat: YouTubeRenderTargetFormat
  status: YouTubeRenderJobStatus
  versionNumber: number
  editBrief?: string
  sourceAssetIds: string[]
  clipCandidateIds: string[]
  timeline: YouTubeRenderTimelineScene[]
  output?: YouTubeRenderOutput
  renderEngine?: YouTubeRenderEngineIntegration
  costControls?: YouTubeMediaCostControls
  error?: YouTubeMediaErrorState
  completedVideoAssetId?: string
  checks: {
    sourceRights: YouTubeGateCheck
    brand: YouTubeGateCheck
    captions: YouTubeGateCheck
    renderQuality: YouTubeGateCheck
    clientApproval: YouTubeGateCheck
  }
  visibility?: { showInClientPortal?: boolean; showTimelineInPortal?: boolean; showOutputsInPortal?: boolean }
  internalNotes?: string
  clientNotes?: string
  executionJobId?: string
  approvedBy?: string
  approvedAt?: unknown
  approvedSnapshotHash?: string
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

export interface YouTubeAgentJob {
  id?: string
  orgId: string
  channelWorkspaceId?: string
  seriesId?: string
  videoProjectId?: string
  skillKey: YouTubeProductionSkillKey
  title: string
  status: YouTubeAgentJobStatus
  priority: YouTubeAgentJobPriority
  inputSummary?: string
  outputArtifactIds: string[]
  blockedReason?: string
  reviewRequired: boolean
  visibility: YouTubeAgentJobVisibility
  inputPacket?: {
    skillKey: YouTubeProductionSkillKey
    skillLabel: string
    family: YouTubeProductionSkillFamily
    inputSummary?: string
    requiredContext: string[]
    outputArtifacts: string[]
    guardrails: string[]
    policySourceKeys: string[]
    references: {
      channelWorkspaceId?: string
      seriesId?: string
      videoProjectId?: string
      sourceAssetIds: string[]
      clipCandidateIds: string[]
      productionDraftIds: string[]
      renderJobIds: string[]
      publishingPacketIds: string[]
      analyticsSnapshotIds: string[]
    }
  }
  linked: {
    taskIds?: string[]
    documentIds?: string[]
    researchItemIds?: string[]
    sourceAssetIds?: string[]
    clipCandidateIds?: string[]
    productionDraftIds?: string[]
    renderJobIds?: string[]
    publishingPacketIds?: string[]
    analyticsSnapshotIds?: string[]
  }
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

export interface YouTubeAnalyticsSnapshot {
  id?: string
  orgId: string
  channelWorkspaceId: string
  videoProjectId?: string
  youtubeVideoId?: string
  seriesId?: string
  periodStart: string
  periodEnd: string
  source: YouTubeAnalyticsSource
  sourceFreshness: YouTubeAnalyticsFreshness
  metrics: YouTubeAnalyticsMetrics
  dimensions?: Record<string, string>
  recommendations: YouTubeAnalyticsRecommendation[]
  clientSummary?: string
  internalNotes?: string
  visibility?: { showInClientPortal?: boolean }
  importedAt?: unknown
  importedBy?: string
  importedByType?: ActorType
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}

export interface YouTubeReleasePlan {
  id?: string
  orgId: string
  channelWorkspaceId: string
  videoProjectId: string
  publishingPacketId: string
  mode: YouTubeReleaseMode
  status: YouTubeReleasePlanStatus
  uploadPrivacyStatus: YouTubePublishingPolicy['defaultVisibility']
  targetVisibility: YouTubePublishingPolicy['defaultVisibility']
  scheduledPublishAt?: unknown
  publicSummary?: string
  internalNotes?: string
  executionJobId?: string
  externalYouTubeVideoId?: string
  externalYouTubeUrl?: string
  publishAttemptCount?: number
  lastPublishAttemptAt?: unknown
  lastPublishError?: string
  publishAuditTrail?: YouTubePublishAuditEvent[]
  checks: {
    approvedPacket: YouTubeGateCheck
    connectedAccount: YouTubeGateCheck
    privateFirst: YouTubeGateCheck
    clientConfirmation: YouTubeGateCheck
    scheduleWindow: YouTubeGateCheck
  }
  visibility?: { showInClientPortal?: boolean }
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  createdByType?: ActorType
  updatedBy?: string
  updatedByType?: ActorType
  deleted: boolean
}
