import type {
  ActorType,
  YouTubeAgentJob,
  YouTubeAgentJobPriority,
  YouTubeAgentJobStatus,
  YouTubeAgentJobVisibility,
  YouTubeAnalyticsFreshness,
  YouTubeAnalyticsMetrics,
  YouTubeAnalyticsRecommendation,
  YouTubeAnalyticsRecommendationConfidence,
  YouTubeAnalyticsRecommendationStatus,
  YouTubeAnalyticsRecommendationType,
  YouTubeAnalyticsSnapshot,
  YouTubeAnalyticsSource,
  YouTubeApiProjectStatus,
  YouTubeApprovalPolicy,
  YouTubeChannelStatus,
  YouTubeChannelWorkspace,
  YouTubeConnectedAccountStatus,
  YouTubeGateCheck,
  YouTubeGateStatus,
  YouTubePublishingPacket,
  YouTubePublishingPolicy,
  YouTubePublishingReadiness,
  YouTubePublishingReadinessLevel,
  YouTubeProductionSkillKey,
  YouTubeSeries,
  YouTubeSeriesCadence,
  YouTubeSeriesFormat,
  YouTubeSeriesStatus,
  YouTubeSourceType,
  YouTubeVideoProject,
  YouTubeVideoStatus,
  YouTubeVideoType,
} from './types'
import { YOUTUBE_PRODUCTION_SKILLS } from './skills'

const CHANNEL_STATUSES: YouTubeChannelStatus[] = ['setup', 'strategy', 'active', 'paused', 'blocked', 'archived']
const SERIES_FORMATS: YouTubeSeriesFormat[] = ['shorts', 'long_form', 'podcast', 'case_study', 'tutorial', 'ads', 'mixed']
const SERIES_CADENCES: YouTubeSeriesCadence[] = ['daily', 'weekly', 'fortnightly', 'monthly', 'campaign', 'ad_hoc']
const SERIES_STATUSES: YouTubeSeriesStatus[] = ['active', 'paused', 'complete', 'archived']
const PUBLISHING_MODES: YouTubePublishingPolicy['allowedModes'] = [
  'manual_handoff',
  'private_api_upload',
  'scheduled_api_publish',
]
const PUBLISHING_VISIBILITIES: YouTubePublishingPolicy['defaultVisibility'][] = ['private', 'unlisted', 'public']
const VIDEO_TYPES: YouTubeVideoType[] = [
  'short',
  'long_form',
  'clip_pack',
  'podcast_episode',
  'webinar_cutdown',
  'testimonial',
  'case_study',
  'tutorial',
  'product_demo',
  'ad_creative',
  'community_update',
]
const VIDEO_STATUSES: YouTubeVideoStatus[] = [
  'intake',
  'briefing',
  'production',
  'internal_review',
  'client_review',
  'changes_requested',
  'publish_ready',
  'scheduled',
  'live',
  'blocked',
  'archived',
]
const SOURCE_TYPES: YouTubeSourceType[] = ['raw_footage', 'source_url', 'transcript', 'research', 'client_request', 'manual']
const CLIENT_REVIEW_STATUSES = ['not_requested', 'requested', 'approved', 'changes_requested', 'rejected'] as const
const PACKET_STATUSES: YouTubePublishingPacket['status'][] = [
  'draft',
  'internal_review',
  'client_review',
  'approved',
  'blocked',
  'published',
]
const GATE_STATUSES: YouTubeGateStatus[] = ['pass', 'warning', 'block', 'not_applicable']
const PRODUCTION_SKILL_KEYS = YOUTUBE_PRODUCTION_SKILLS.map((skill) => skill.key) as YouTubeProductionSkillKey[]
const AGENT_JOB_STATUSES: YouTubeAgentJobStatus[] = [
  'queued',
  'running',
  'waiting_for_review',
  'completed',
  'failed',
  'cancelled',
]
const AGENT_JOB_PRIORITIES: YouTubeAgentJobPriority[] = ['low', 'normal', 'high', 'urgent']
const AGENT_JOB_VISIBILITIES: YouTubeAgentJobVisibility[] = ['internal', 'client_visible']
const ANALYTICS_SOURCES: YouTubeAnalyticsSource[] = ['youtube_analytics_api', 'youtube_reporting_api', 'manual_import']
const ANALYTICS_FRESHNESS: YouTubeAnalyticsFreshness[] = ['fresh', 'delayed', 'partial', 'estimated']
const ANALYTICS_RECOMMENDATION_TYPES: YouTubeAnalyticsRecommendationType[] = [
  'retitle',
  'thumbnail_test',
  'shorts_pack',
  'follow_up_video',
  'series_change',
  'cadence_change',
]
const ANALYTICS_RECOMMENDATION_CONFIDENCES: YouTubeAnalyticsRecommendationConfidence[] = ['low', 'medium', 'high']
const ANALYTICS_RECOMMENDATION_STATUSES: YouTubeAnalyticsRecommendationStatus[] = [
  'suggested',
  'accepted',
  'rejected',
  'converted_to_task',
]
const ACTOR_TYPES: ActorType[] = ['user', 'agent', 'system']
const CONNECTED_ACCOUNT_STATUSES: YouTubeConnectedAccountStatus[] = [
  'not_connected',
  'connected',
  'needs_reauth',
  'revoked',
  'blocked',
]
const API_PROJECT_STATUSES: YouTubeApiProjectStatus[] = [
  'unknown',
  'unverified_private_only',
  'verified',
  'audit_required',
  'quota_limited',
  'blocked',
]
const PUBLISHING_READINESS_LEVELS: YouTubePublishingReadinessLevel[] = [
  'not_ready',
  'manual_only',
  'private_upload_ready',
  'scheduled_publish_ready',
  'blocked',
]

type RawInput = Record<string, unknown>
type PacketReviewCheckKey = Exclude<keyof YouTubePublishingPacket['checks'], 'connectedAccount'>
type ClientSafePacketTitleOption = YouTubePublishingPacket['titleOptions'][number]
type ClientSafePacketChapter = YouTubePublishingPacket['chapters'][number]

export type ClientSafeYouTubeChannelWorkspace = {
  id?: string
  orgId: string
  title: string
  youtubeChannelId?: string
  youtubeHandle?: string
  status: YouTubeChannelStatus
  contentPillars: string[]
  audienceNotes?: string
  clientNotes?: string
  aiDisclosureDefaults?: { syntheticMediaLikely: boolean; notes?: string }
  visibility?: Pick<NonNullable<YouTubeChannelWorkspace['visibility']>, 'showInClientPortal' | 'showAnalytics'>
}

export type ClientSafeYouTubeVideoProject = {
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
  source: Pick<YouTubeVideoProject['source'], 'intakeType'>
  clientReview?: Pick<NonNullable<YouTubeVideoProject['clientReview']>, 'status' | 'notes'>
  clientNotes?: string
  visibility?: Pick<
    NonNullable<YouTubeVideoProject['visibility']>,
    'showInClientPortal' | 'showAnalytics' | 'showPublishingPacket'
  >
}

export type ClientSafeYouTubeSeries = {
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
}

type ClientSafeSeriesSection = ClientSafeYouTubeSeries['episodeTemplate']['sections'][number]

export type ClientSafeYouTubeGateCheck = Pick<YouTubeGateCheck, 'status'> & {
  message?: string
}

export type ClientSafeYouTubePublishingPacket = Pick<
  YouTubePublishingPacket,
  | 'id'
  | 'orgId'
  | 'channelWorkspaceId'
  | 'videoProjectId'
  | 'versionNumber'
  | 'status'
  | 'titleOptions'
  | 'description'
  | 'tags'
  | 'chapters'
  | 'visibility'
  | 'selfDeclaredMadeForKids'
  | 'containsSyntheticMedia'
  | 'aiDisclosureNotes'
> & {
  checks: Partial<Record<PacketReviewCheckKey, ClientSafeYouTubeGateCheck>>
}

export type ClientSafeYouTubeAnalyticsSnapshot = Pick<
  YouTubeAnalyticsSnapshot,
  | 'id'
  | 'orgId'
  | 'channelWorkspaceId'
  | 'videoProjectId'
  | 'seriesId'
  | 'periodStart'
  | 'periodEnd'
  | 'source'
  | 'sourceFreshness'
  | 'metrics'
  | 'clientSummary'
> & {
  recommendations: Array<Pick<YouTubeAnalyticsRecommendation, 'type' | 'summary' | 'confidence' | 'status'>>
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function cleanNonNegativeNumber(value: unknown): number | undefined {
  const number = cleanNumber(value)
  return number !== undefined && number >= 0 ? number : undefined
}

function cleanBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function cleanObject(value: unknown): RawInput {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RawInput : {}
}

function cleanStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(cleanString).filter((item): item is string => Boolean(item))
  if (typeof value === 'string') return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
  return []
}

function cleanStringRecord(value: unknown): Record<string, string> | undefined {
  const source = cleanObject(value)
  const entries = Object.entries(source).flatMap(([key, entry]) => {
    const safeKey = cleanString(key)
    const safeValue = cleanString(entry)
    return safeKey && safeValue ? [[safeKey, safeValue] as const] : []
  })

  return entries.length ? Object.fromEntries(entries) : undefined
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

function isPlainObject(value: unknown): value is RawInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as T
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) => {
        if (entry === undefined) return []
        const cleanEntry = stripUndefinedDeep(entry)
        return cleanEntry === undefined ? [] : [[key, cleanEntry]]
      })
    ) as T
  }

  return value
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

function pick<T extends string>(values: readonly T[], input: unknown, fallback: T): T {
  return values.includes(input as T) ? input as T : fallback
}

export function defaultYouTubeApprovalPolicy(): YouTubeApprovalPolicy {
  return {
    requireInternalBriefApproval: true,
    requireClientBriefApproval: false,
    requireClientScriptApproval: false,
    requireClientDraftApproval: true,
    requireClientThumbnailApproval: false,
    requireClientPublishConfirmation: false,
    requireInternalPublishApproval: true,
  }
}

export function defaultYouTubePublishingPolicy(): YouTubePublishingPolicy {
  return {
    allowedModes: ['manual_handoff'],
    defaultVisibility: 'private',
    privateFirstRequired: true,
    publicPublishRequiresAdmin: true,
    publicPublishRequiresClientConfirmation: false,
  }
}

export function sanitizeYouTubePublishingPolicyInput(input: unknown): YouTubePublishingPolicy {
  const source = cleanObject(input)
  const defaults = defaultYouTubePublishingPolicy()
  const allowedModes = cleanStringArray(source.allowedModes).filter((mode): mode is YouTubePublishingPolicy['allowedModes'][number] =>
    PUBLISHING_MODES.includes(mode as YouTubePublishingPolicy['allowedModes'][number])
  )

  return {
    allowedModes: allowedModes.length ? allowedModes : defaults.allowedModes,
    defaultVisibility: pick(PUBLISHING_VISIBILITIES, source.defaultVisibility, defaults.defaultVisibility),
    privateFirstRequired: cleanBoolean(source.privateFirstRequired) ?? defaults.privateFirstRequired,
    publicPublishRequiresAdmin: cleanBoolean(source.publicPublishRequiresAdmin) ?? defaults.publicPublishRequiresAdmin,
    publicPublishRequiresClientConfirmation:
      cleanBoolean(source.publicPublishRequiresClientConfirmation) ?? defaults.publicPublishRequiresClientConfirmation,
  }
}

export function sanitizeYouTubePublishingReadinessInput(input: unknown): YouTubePublishingReadiness {
  const source = cleanObject(input)
  const allowedModes = cleanStringArray(source.allowedModes).filter((mode): mode is YouTubePublishingPolicy['allowedModes'][number] =>
    PUBLISHING_MODES.includes(mode as YouTubePublishingPolicy['allowedModes'][number])
  )

  return stripUndefinedDeep({
    accountStatus: pick(CONNECTED_ACCOUNT_STATUSES, source.accountStatus, 'not_connected'),
    apiProjectStatus: pick(API_PROJECT_STATUSES, source.apiProjectStatus, 'unknown'),
    readiness: pick(PUBLISHING_READINESS_LEVELS, source.readiness, 'not_ready'),
    defaultUploadPrivacy: pick(PUBLISHING_VISIBILITIES, source.defaultUploadPrivacy, 'private'),
    allowedModes: allowedModes.length ? allowedModes : ['manual_handoff'],
    quotaDailyLimit: cleanNonNegativeNumber(source.quotaDailyLimit),
    quotaUnitsRemaining: cleanNonNegativeNumber(source.quotaUnitsRemaining),
    lastCheckedAt: source.lastCheckedAt,
    checkedBy: cleanString(source.checkedBy),
    checkedByType: ACTOR_TYPES.includes(source.checkedByType as ActorType) ? source.checkedByType as ActorType : undefined,
    notes: cleanString(source.notes),
  })
}

function approvalPolicyFrom(input: unknown): YouTubeApprovalPolicy {
  const source = cleanObject(input)
  const defaults = defaultYouTubeApprovalPolicy()

  return {
    requireInternalBriefApproval: cleanBoolean(source.requireInternalBriefApproval) ?? defaults.requireInternalBriefApproval,
    requireClientBriefApproval: cleanBoolean(source.requireClientBriefApproval) ?? defaults.requireClientBriefApproval,
    requireClientScriptApproval: cleanBoolean(source.requireClientScriptApproval) ?? defaults.requireClientScriptApproval,
    requireClientDraftApproval: cleanBoolean(source.requireClientDraftApproval) ?? defaults.requireClientDraftApproval,
    requireClientThumbnailApproval: cleanBoolean(source.requireClientThumbnailApproval) ?? defaults.requireClientThumbnailApproval,
    requireClientPublishConfirmation:
      cleanBoolean(source.requireClientPublishConfirmation) ?? defaults.requireClientPublishConfirmation,
    requireInternalPublishApproval:
      cleanBoolean(source.requireInternalPublishApproval) ?? defaults.requireInternalPublishApproval,
  }
}

// These sanitizers produce full create/replace Firestore payloads. PATCH callers must merge with
// the existing record first, or use dedicated partial-update sanitizers once those exist.
export function sanitizeYouTubeChannelWorkspaceInput(
  input: RawInput
): Omit<YouTubeChannelWorkspace, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'> {
  const disclosure = cleanObject(input.aiDisclosureDefaults)
  const visibility = cleanObject(input.visibility)

  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    title: cleanString(input.title) ?? 'Untitled YouTube channel',
    youtubeChannelId: cleanString(input.youtubeChannelId),
    youtubeHandle: cleanString(input.youtubeHandle),
    status: pick(CHANNEL_STATUSES, input.status, 'setup'),
    connectedAccountId: cleanString(input.connectedAccountId),
    strategyDocumentId: cleanString(input.strategyDocumentId),
    publishingReadiness: input.publishingReadiness
      ? sanitizeYouTubePublishingReadinessInput(input.publishingReadiness)
      : undefined,
    defaultApprovalPolicy: approvalPolicyFrom(input.defaultApprovalPolicy),
    defaultPublishingPolicy: sanitizeYouTubePublishingPolicyInput(input.defaultPublishingPolicy),
    contentPillars: cleanStringArray(input.contentPillars),
    audienceNotes: cleanString(input.audienceNotes),
    avoidTopics: cleanStringArray(input.avoidTopics),
    aiDisclosureDefaults: {
      syntheticMediaLikely: disclosure.syntheticMediaLikely === true,
      notes: cleanString(disclosure.notes),
    },
    internalNotes: cleanString(input.internalNotes),
    clientNotes: cleanString(input.clientNotes),
    visibility: {
      showInClientPortal: visibility.showInClientPortal !== false,
      showAnalytics: visibility.showAnalytics !== false,
    },
    deleted: input.deleted === true,
  })
}

export function sanitizeYouTubeSeriesInput(input: RawInput): Omit<YouTubeSeries, 'id'> {
  const template = cleanObject(input.episodeTemplate)
  const style = cleanObject(input.styleGuide)
  const rawSections = Array.isArray(template.sections) ? template.sections : []

  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    name: cleanString(input.name) ?? 'Untitled series',
    objective: cleanString(input.objective),
    audience: cleanString(input.audience),
    format: pick(SERIES_FORMATS, input.format, 'mixed'),
    cadence: pick(SERIES_CADENCES, input.cadence, 'ad_hoc'),
    targetDurationSeconds: cleanNumber(input.targetDurationSeconds),
    episodeTemplate: {
      hook: cleanString(template.hook),
      sections: rawSections.flatMap((entry) => {
        const item = cleanObject(entry)
        const label = cleanString(item.label)
        return label ? [compact({ label, targetSeconds: cleanNumber(item.targetSeconds), notes: cleanString(item.notes) })] : []
      }) as Array<{ label: string; targetSeconds?: number; notes?: string }>,
      outro: cleanString(template.outro),
    },
    styleGuide: {
      visualNotes: cleanString(style.visualNotes),
      thumbnailNotes: cleanString(style.thumbnailNotes),
      captionNotes: cleanString(style.captionNotes),
      introOutroRules: cleanString(style.introOutroRules),
    },
    season: cleanString(input.season),
    status: pick(SERIES_STATUSES, input.status, 'active'),
    deleted: input.deleted === true,
  })
}

export function sanitizeYouTubeVideoProjectInput(
  input: RawInput
): Omit<YouTubeVideoProject, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'> {
  const source = cleanObject(input.source)
  const linked = cleanObject(input.linked)
  const review = cleanObject(input.clientReview)
  const visibility = cleanObject(input.visibility)

  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    seriesId: cleanString(input.seriesId),
    title: cleanString(input.title) ?? 'Untitled video',
    workingTitle: cleanString(input.workingTitle),
    videoType: pick(VIDEO_TYPES, input.videoType, 'long_form'),
    status: pick(VIDEO_STATUSES, input.status, 'intake'),
    objective: cleanString(input.objective) ?? '',
    targetAudience: cleanString(input.targetAudience),
    targetDurationSeconds: cleanNumber(input.targetDurationSeconds),
    source: {
      intakeType: pick(SOURCE_TYPES, source.intakeType, 'manual'),
      researchItemId: cleanString(source.researchItemId),
      campaignId: cleanString(source.campaignId),
      projectId: cleanString(source.projectId),
      sourceUrl: cleanString(source.sourceUrl),
      transcriptAssetId: cleanString(source.transcriptAssetId),
    },
    linked: {
      projectId: cleanString(linked.projectId),
      taskIds: cleanStringArray(linked.taskIds),
      documentIds: cleanStringArray(linked.documentIds),
      campaignId: cleanString(linked.campaignId),
      socialPostIds: cleanStringArray(linked.socialPostIds),
    },
    approvalPolicy: approvalPolicyFrom(input.approvalPolicy),
    publishPacketId: cleanString(input.publishPacketId),
    youtubeVideoId: cleanString(input.youtubeVideoId),
    scheduledAt: input.scheduledAt,
    publishedAt: input.publishedAt,
    clientReview: {
      status: pick(['not_requested', 'requested', 'approved', 'changes_requested', 'rejected'] as const, review.status, 'not_requested'),
      notes: cleanString(review.notes),
      decidedAt: review.decidedAt,
      decidedBy: cleanString(review.decidedBy),
    },
    internalNotes: cleanString(input.internalNotes),
    clientNotes: cleanString(input.clientNotes),
    visibility: {
      showInClientPortal: visibility.showInClientPortal !== false,
      showAnalytics: visibility.showAnalytics !== false,
      showPublishingPacket: visibility.showPublishingPacket === true,
    },
    deleted: input.deleted === true,
  })
}

export function sanitizeYouTubeAgentJobInput(
  input: RawInput
): Omit<YouTubeAgentJob, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'> {
  const linked = cleanObject(input.linked)

  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId),
    seriesId: cleanString(input.seriesId),
    videoProjectId: cleanString(input.videoProjectId),
    skillKey: pick(PRODUCTION_SKILL_KEYS, input.skillKey, 'youtube-video-brief'),
    title: cleanString(input.title) ?? 'YouTube production job',
    status: pick(AGENT_JOB_STATUSES, input.status, 'queued'),
    priority: pick(AGENT_JOB_PRIORITIES, input.priority, 'normal'),
    inputSummary: cleanString(input.inputSummary),
    outputArtifactIds: cleanStringArray(input.outputArtifactIds),
    blockedReason: cleanString(input.blockedReason),
    reviewRequired: cleanBoolean(input.reviewRequired) ?? true,
    visibility: pick(AGENT_JOB_VISIBILITIES, input.visibility, 'internal'),
    linked: {
      taskIds: cleanStringArray(linked.taskIds),
      documentIds: cleanStringArray(linked.documentIds),
      researchItemIds: cleanStringArray(linked.researchItemIds),
    },
    deleted: input.deleted === true,
  })
}

function sanitizeYouTubeAnalyticsMetrics(input: unknown): YouTubeAnalyticsMetrics {
  const source = cleanObject(input)

  return stripUndefinedDeep({
    views: cleanNonNegativeNumber(source.views),
    watchTimeMinutes: cleanNonNegativeNumber(source.watchTimeMinutes),
    averageViewDurationSeconds: cleanNonNegativeNumber(source.averageViewDurationSeconds),
    averageViewPercentage: cleanNonNegativeNumber(source.averageViewPercentage),
    impressions: cleanNonNegativeNumber(source.impressions),
    impressionsCtr: cleanNonNegativeNumber(source.impressionsCtr),
    subscribersGained: cleanNonNegativeNumber(source.subscribersGained),
    subscribersLost: cleanNonNegativeNumber(source.subscribersLost),
    likes: cleanNonNegativeNumber(source.likes),
    comments: cleanNonNegativeNumber(source.comments),
    shares: cleanNonNegativeNumber(source.shares),
  })
}

function sanitizeYouTubeAnalyticsRecommendations(input: unknown): YouTubeAnalyticsRecommendation[] {
  if (!Array.isArray(input)) return []

  return input.flatMap((entry) => {
    const source = cleanObject(entry)
    const summary = cleanString(source.summary)
    if (!summary) return []

    return [stripUndefinedDeep({
      type: pick(ANALYTICS_RECOMMENDATION_TYPES, source.type, 'follow_up_video'),
      summary,
      confidence: pick(ANALYTICS_RECOMMENDATION_CONFIDENCES, source.confidence, 'low'),
      status: pick(ANALYTICS_RECOMMENDATION_STATUSES, source.status, 'suggested'),
      taskId: cleanString(source.taskId),
      notes: cleanString(source.notes),
    })]
  })
}

export function sanitizeYouTubeAnalyticsSnapshotInput(
  input: RawInput
): Omit<
  YouTubeAnalyticsSnapshot,
  | 'id'
  | 'importedAt'
  | 'importedBy'
  | 'importedByType'
  | 'createdAt'
  | 'updatedAt'
  | 'createdBy'
  | 'createdByType'
  | 'updatedBy'
  | 'updatedByType'
> {
  const visibility = cleanObject(input.visibility)

  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    videoProjectId: cleanString(input.videoProjectId),
    youtubeVideoId: cleanString(input.youtubeVideoId),
    seriesId: cleanString(input.seriesId),
    periodStart: cleanString(input.periodStart) ?? '',
    periodEnd: cleanString(input.periodEnd) ?? '',
    source: pick(ANALYTICS_SOURCES, input.source, 'manual_import'),
    sourceFreshness: pick(ANALYTICS_FRESHNESS, input.sourceFreshness, 'partial'),
    metrics: sanitizeYouTubeAnalyticsMetrics(input.metrics),
    dimensions: cleanStringRecord(input.dimensions),
    recommendations: sanitizeYouTubeAnalyticsRecommendations(input.recommendations),
    clientSummary: cleanString(input.clientSummary),
    internalNotes: cleanString(input.internalNotes),
    visibility: {
      showInClientPortal: visibility.showInClientPortal === true,
    },
    deleted: input.deleted === true,
  })
}

export function serializeYouTubeRecord<T extends object>(id: string, data: Record<string, unknown>): T & { id: string } {
  return { id, ...(JSON.parse(JSON.stringify(data)) as T) }
}

export function clientSafeYouTubeChannelWorkspace(
  channel: YouTubeChannelWorkspace
): ClientSafeYouTubeChannelWorkspace {
  const disclosure = cleanObject(channel.aiDisclosureDefaults)
  const visibility = cleanObject(channel.visibility)

  return stripUndefinedDeep({
    id: cleanString(channel.id),
    orgId: cleanString(channel.orgId) ?? '',
    title: cleanString(channel.title) ?? 'Untitled YouTube channel',
    youtubeChannelId: cleanString(channel.youtubeChannelId),
    youtubeHandle: cleanString(channel.youtubeHandle),
    status: pick(CHANNEL_STATUSES, channel.status, 'setup'),
    contentPillars: cleanStringArray(channel.contentPillars),
    audienceNotes: cleanString(channel.audienceNotes),
    clientNotes: cleanString(channel.clientNotes),
    aiDisclosureDefaults: channel.aiDisclosureDefaults
      ? {
          syntheticMediaLikely: cleanBoolean(disclosure.syntheticMediaLikely) ?? false,
          notes: cleanString(disclosure.notes),
        }
      : undefined,
    visibility: channel.visibility
      ? {
          showInClientPortal: cleanBoolean(visibility.showInClientPortal),
          showAnalytics: cleanBoolean(visibility.showAnalytics),
        }
      : undefined,
  })
}

function clientSafeSeriesSection(section: unknown): ClientSafeSeriesSection | undefined {
  const source = cleanObject(section)
  const label = cleanString(source.label)
  if (!label) return undefined

  const targetSeconds = cleanNumber(source.targetSeconds)
  const notes = cleanString(source.notes)
  const safeSection: ClientSafeSeriesSection = { label }

  if (targetSeconds !== undefined && targetSeconds >= 0) safeSection.targetSeconds = targetSeconds
  if (notes) safeSection.notes = notes

  return safeSection
}

export function clientSafeYouTubeSeries(series: YouTubeSeries): ClientSafeYouTubeSeries {
  const template = cleanObject(series.episodeTemplate)
  const style = cleanObject(series.styleGuide)

  return stripUndefinedDeep({
    id: cleanString(series.id),
    orgId: cleanString(series.orgId) ?? '',
    channelWorkspaceId: cleanString(series.channelWorkspaceId) ?? '',
    name: cleanString(series.name) ?? 'Untitled series',
    objective: cleanString(series.objective),
    audience: cleanString(series.audience),
    format: pick(SERIES_FORMATS, series.format, 'mixed'),
    cadence: pick(SERIES_CADENCES, series.cadence, 'ad_hoc'),
    targetDurationSeconds: cleanNumber(series.targetDurationSeconds),
    episodeTemplate: {
      hook: cleanString(template.hook),
      sections: Array.isArray(template.sections)
        ? template.sections.map(clientSafeSeriesSection).filter(isDefined)
        : [],
      outro: cleanString(template.outro),
    },
    styleGuide: {
      visualNotes: cleanString(style.visualNotes),
      thumbnailNotes: cleanString(style.thumbnailNotes),
      captionNotes: cleanString(style.captionNotes),
      introOutroRules: cleanString(style.introOutroRules),
    },
    season: cleanString(series.season),
    status: pick(SERIES_STATUSES, series.status, 'active'),
  })
}

export function clientSafeYouTubeVideoProject(video: YouTubeVideoProject): ClientSafeYouTubeVideoProject {
  const source = cleanObject(video.source)
  const review = cleanObject(video.clientReview)
  const visibility = cleanObject(video.visibility)

  return stripUndefinedDeep({
    id: cleanString(video.id),
    orgId: cleanString(video.orgId) ?? '',
    channelWorkspaceId: cleanString(video.channelWorkspaceId) ?? '',
    seriesId: cleanString(video.seriesId),
    title: cleanString(video.title) ?? 'Untitled video',
    workingTitle: cleanString(video.workingTitle),
    videoType: pick(VIDEO_TYPES, video.videoType, 'long_form'),
    status: pick(VIDEO_STATUSES, video.status, 'intake'),
    objective: cleanString(video.objective) ?? '',
    targetAudience: cleanString(video.targetAudience),
    targetDurationSeconds: cleanNumber(video.targetDurationSeconds),
    source: {
      intakeType: pick(SOURCE_TYPES, source.intakeType, 'manual'),
    },
    clientReview: video.clientReview
      ? {
          status: pick(CLIENT_REVIEW_STATUSES, review.status, 'not_requested'),
          notes: cleanString(review.notes),
        }
      : undefined,
    clientNotes: cleanString(video.clientNotes),
    visibility: video.visibility
      ? {
          showInClientPortal: cleanBoolean(visibility.showInClientPortal),
          showAnalytics: cleanBoolean(visibility.showAnalytics),
          showPublishingPacket: cleanBoolean(visibility.showPublishingPacket),
        }
      : undefined,
  })
}

function clientSafeGateCheck(check?: unknown): ClientSafeYouTubeGateCheck | undefined {
  if (!check) return undefined
  const source = cleanObject(check)

  return stripUndefinedDeep({
    status: pick(GATE_STATUSES, source.status, 'not_applicable'),
    message: cleanString(source.message),
  })
}

function clientSafePacketTitleOption(option: unknown): ClientSafePacketTitleOption | undefined {
  const source = cleanObject(option)
  const text = cleanString(source.text)
  if (!text) return undefined

  return stripUndefinedDeep({
    text,
    rationale: cleanString(source.rationale),
    selected: cleanBoolean(source.selected),
  })
}

function clientSafePacketChapter(chapter: unknown): ClientSafePacketChapter | undefined {
  const source = cleanObject(chapter)
  const startSeconds = cleanNumber(source.startSeconds)
  const title = cleanString(source.title)
  if (startSeconds === undefined || startSeconds < 0 || !title) return undefined

  return { startSeconds, title }
}

export function clientSafeYouTubePublishingPacket(
  packet: YouTubePublishingPacket
): ClientSafeYouTubePublishingPacket {
  const checks = cleanObject(packet.checks)

  return stripUndefinedDeep({
    id: cleanString(packet.id),
    orgId: cleanString(packet.orgId) ?? '',
    channelWorkspaceId: cleanString(packet.channelWorkspaceId) ?? '',
    videoProjectId: cleanString(packet.videoProjectId) ?? '',
    versionNumber: cleanNumber(packet.versionNumber) ?? 1,
    status: pick(PACKET_STATUSES, packet.status, 'draft'),
    titleOptions: Array.isArray(packet.titleOptions)
      ? packet.titleOptions.map(clientSafePacketTitleOption).filter(isDefined)
      : [],
    description: cleanString(packet.description),
    tags: cleanStringArray(packet.tags),
    chapters: Array.isArray(packet.chapters)
      ? packet.chapters.map(clientSafePacketChapter).filter(isDefined)
      : [],
    visibility: pick(PUBLISHING_VISIBILITIES, packet.visibility, 'private'),
    selfDeclaredMadeForKids: cleanBoolean(packet.selfDeclaredMadeForKids),
    containsSyntheticMedia: cleanBoolean(packet.containsSyntheticMedia),
    aiDisclosureNotes: cleanString(packet.aiDisclosureNotes),
    checks: {
      rights: clientSafeGateCheck(checks.rights),
      aiDisclosure: clientSafeGateCheck(checks.aiDisclosure),
      madeForKids: clientSafeGateCheck(checks.madeForKids),
      metadata: clientSafeGateCheck(checks.metadata),
      thumbnail: clientSafeGateCheck(checks.thumbnail),
      captions: clientSafeGateCheck(checks.captions),
      approval: clientSafeGateCheck(checks.approval),
    },
  })
}

function clientSafeAnalyticsRecommendation(recommendation: unknown) {
  const source = cleanObject(recommendation)
  const summary = cleanString(source.summary)
  if (!summary) return undefined

  return {
    type: pick(ANALYTICS_RECOMMENDATION_TYPES, source.type, 'follow_up_video'),
    summary,
    confidence: pick(ANALYTICS_RECOMMENDATION_CONFIDENCES, source.confidence, 'low'),
    status: pick(ANALYTICS_RECOMMENDATION_STATUSES, source.status, 'suggested'),
  }
}

export function clientSafeYouTubeAnalyticsSnapshot(
  snapshot: YouTubeAnalyticsSnapshot
): ClientSafeYouTubeAnalyticsSnapshot {
  return stripUndefinedDeep({
    id: cleanString(snapshot.id),
    orgId: cleanString(snapshot.orgId) ?? '',
    channelWorkspaceId: cleanString(snapshot.channelWorkspaceId) ?? '',
    videoProjectId: cleanString(snapshot.videoProjectId),
    seriesId: cleanString(snapshot.seriesId),
    periodStart: cleanString(snapshot.periodStart) ?? '',
    periodEnd: cleanString(snapshot.periodEnd) ?? '',
    source: pick(ANALYTICS_SOURCES, snapshot.source, 'manual_import'),
    sourceFreshness: pick(ANALYTICS_FRESHNESS, snapshot.sourceFreshness, 'partial'),
    metrics: sanitizeYouTubeAnalyticsMetrics(snapshot.metrics),
    clientSummary: cleanString(snapshot.clientSummary),
    recommendations: Array.isArray(snapshot.recommendations)
      ? snapshot.recommendations.map(clientSafeAnalyticsRecommendation).filter(isDefined)
      : [],
  })
}
