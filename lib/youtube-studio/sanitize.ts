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
  YouTubeClipCandidate,
  YouTubeClipCandidateStatus,
  YouTubeClipTargetFormat,
  YouTubeConnectedAccountStatus,
  YouTubeGateCheck,
  YouTubeGateStatus,
  YouTubeProductionDraft,
  YouTubeProductionDraftScene,
  YouTubeProductionDraftStatus,
  YouTubeProductionDraftType,
  YouTubePublishingPacket,
  YouTubePublishingPolicy,
  YouTubePublishingReadiness,
  YouTubePublishingReadinessLevel,
  YouTubeProductionSkillKey,
  YouTubeRenderJob,
  YouTubeRenderJobStatus,
  YouTubeRenderJobType,
  YouTubeRenderOutput,
  YouTubeRenderTargetFormat,
  YouTubeRenderTimelineScene,
  YouTubeReleaseMode,
  YouTubeReleasePlan,
  YouTubeReleasePlanStatus,
  YouTubeSeries,
  YouTubeSeriesCadence,
  YouTubeSeriesFormat,
  YouTubeSeriesStatus,
  YouTubeSourceAsset,
  YouTubeSourceAssetMediaFormat,
  YouTubeSourceAssetStatus,
  YouTubeSourceAssetType,
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
const SOURCE_ASSET_TYPES: YouTubeSourceAssetType[] = [
  'raw_footage',
  'source_url',
  'transcript',
  'thumbnail',
  'audio',
  'caption',
  'broll',
  'image',
  'document',
  'rendered_video',
]
const SOURCE_ASSET_STATUSES: YouTubeSourceAssetStatus[] = [
  'intake',
  'processing',
  'ready',
  'needs_rights_review',
  'blocked',
  'archived',
]
const SOURCE_ASSET_MEDIA_FORMATS: YouTubeSourceAssetMediaFormat[] = [
  'horizontal',
  'vertical',
  'square',
  'audio',
  'document',
  'unknown',
]
const SOURCE_ASSET_RIGHT_STATUSES: Array<NonNullable<NonNullable<YouTubeSourceAsset['rights']>['status']>> = [
  'unknown',
  'cleared',
  'needs_review',
  'blocked',
]
const CLIP_CANDIDATE_STATUSES: YouTubeClipCandidateStatus[] = [
  'suggested',
  'selected',
  'rejected',
  'needs_review',
  'exported',
  'archived',
]
const CLIP_TARGET_FORMATS: YouTubeClipTargetFormat[] = [
  'vertical_short',
  'square_short',
  'long_form_excerpt',
  'ad_cutdown',
  'testimonial_cut',
]
const PRODUCTION_DRAFT_TYPES: YouTubeProductionDraftType[] = [
  'brief',
  'outline',
  'script',
  'storyboard',
  'shot_list',
  'voiceover',
  'edit_notes',
]
const PRODUCTION_DRAFT_STATUSES: YouTubeProductionDraftStatus[] = [
  'draft',
  'internal_review',
  'client_review',
  'approved',
  'changes_requested',
  'blocked',
  'archived',
]
const RENDER_JOB_TYPES: YouTubeRenderJobType[] = ['full_video', 'short_clip', 'clip_pack', 'trailer', 'thumbnail_motion']
const RENDER_TARGET_FORMATS: YouTubeRenderTargetFormat[] = ['horizontal_16_9', 'vertical_9_16', 'square_1_1']
const RENDER_JOB_STATUSES: YouTubeRenderJobStatus[] = [
  'planning',
  'ready_for_edit',
  'rendering',
  'rendered',
  'qa_review',
  'approved',
  'blocked',
  'cancelled',
]
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
const RELEASE_MODES: YouTubeReleaseMode[] = ['manual_handoff', 'private_api_upload', 'scheduled_api_publish']
const RELEASE_PLAN_STATUSES: YouTubeReleasePlanStatus[] = [
  'draft',
  'ready',
  'scheduled',
  'published',
  'blocked',
  'cancelled',
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
type ClientSafeSourceAssetRights = Pick<NonNullable<YouTubeSourceAsset['rights']>, 'status' | 'owner' | 'license'>

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

export type ClientSafeYouTubeReleasePlan = Pick<
  YouTubeReleasePlan,
  | 'id'
  | 'orgId'
  | 'channelWorkspaceId'
  | 'videoProjectId'
  | 'publishingPacketId'
  | 'mode'
  | 'status'
  | 'targetVisibility'
  | 'scheduledPublishAt'
  | 'publicSummary'
> & {
  checks: {
    approvedPacket?: ClientSafeYouTubeGateCheck
    connectedAccount?: ClientSafeYouTubeGateCheck
    privateFirst?: ClientSafeYouTubeGateCheck
    clientConfirmation?: ClientSafeYouTubeGateCheck
    scheduleWindow?: ClientSafeYouTubeGateCheck
  }
}

export type ClientSafeYouTubeSourceAsset = Pick<
  YouTubeSourceAsset,
  | 'id'
  | 'orgId'
  | 'channelWorkspaceId'
  | 'videoProjectId'
  | 'seriesId'
  | 'title'
  | 'description'
  | 'assetType'
  | 'status'
  | 'durationSeconds'
  | 'mediaFormat'
  | 'sourceUrl'
  | 'transcriptAssetId'
  | 'clientNotes'
> & {
  rights?: ClientSafeSourceAssetRights
}

export type ClientSafeYouTubeClipCandidate = Pick<
  YouTubeClipCandidate,
  | 'id'
  | 'orgId'
  | 'channelWorkspaceId'
  | 'videoProjectId'
  | 'sourceAssetId'
  | 'title'
  | 'summary'
  | 'startSeconds'
  | 'endSeconds'
  | 'targetFormat'
  | 'status'
  | 'hook'
  | 'transcriptExcerpt'
> & {
  checks: {
    rights?: ClientSafeYouTubeGateCheck
    aiDisclosure?: ClientSafeYouTubeGateCheck
  }
}

type ClientSafeProductionDraftScene = Pick<
  YouTubeProductionDraftScene,
  'label' | 'summary' | 'targetSeconds' | 'voiceover' | 'visualNotes' | 'onScreenText'
>

export type ClientSafeYouTubeProductionDraft = Pick<
  YouTubeProductionDraft,
  | 'id'
  | 'orgId'
  | 'channelWorkspaceId'
  | 'videoProjectId'
  | 'title'
  | 'draftType'
  | 'status'
  | 'versionNumber'
  | 'summary'
  | 'hook'
  | 'outline'
  | 'scriptText'
  | 'clientNotes'
> & {
  scenes: ClientSafeProductionDraftScene[]
  checks: {
    claims?: ClientSafeYouTubeGateCheck
    brand?: ClientSafeYouTubeGateCheck
    sourceEvidence?: ClientSafeYouTubeGateCheck
    clientApproval?: ClientSafeYouTubeGateCheck
  }
}

type ClientSafeRenderTimelineScene = Pick<
  YouTubeRenderTimelineScene,
  'label' | 'summary' | 'startSeconds' | 'endSeconds' | 'voiceover' | 'onScreenText' | 'editNotes'
>

type ClientSafeRenderOutput = Pick<
  YouTubeRenderOutput,
  'previewUrl' | 'downloadUrl' | 'durationSeconds'
>

export type ClientSafeYouTubeRenderJob = Pick<
  YouTubeRenderJob,
  | 'id'
  | 'orgId'
  | 'channelWorkspaceId'
  | 'videoProjectId'
  | 'productionDraftId'
  | 'title'
  | 'renderType'
  | 'targetFormat'
  | 'status'
  | 'versionNumber'
  | 'editBrief'
  | 'clientNotes'
> & {
  timeline: ClientSafeRenderTimelineScene[]
  output?: ClientSafeRenderOutput
  checks: {
    sourceRights?: ClientSafeYouTubeGateCheck
    brand?: ClientSafeYouTubeGateCheck
    captions?: ClientSafeYouTubeGateCheck
    renderQuality?: ClientSafeYouTubeGateCheck
    clientApproval?: ClientSafeYouTubeGateCheck
  }
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

function uniqueCleanStringArray(value: unknown): string[] {
  return Array.from(new Set(cleanStringArray(value)))
}

function cleanPositiveInteger(value: unknown, fallback = 1): number {
  const number = cleanNonNegativeNumber(value)
  if (number === undefined || number < 1) return fallback
  return Math.floor(number)
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

function sanitizeSourceAssetRights(input: unknown): YouTubeSourceAsset['rights'] | undefined {
  const source = cleanObject(input)
  if (!Object.keys(source).length) return undefined

  return stripUndefinedDeep({
    status: pick(SOURCE_ASSET_RIGHT_STATUSES, source.status, 'unknown'),
    owner: cleanString(source.owner),
    license: cleanString(source.license),
    notes: cleanString(source.notes),
  })
}

export function sanitizeYouTubeSourceAssetInput(
  input: RawInput
): Omit<YouTubeSourceAsset, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'> {
  const visibility = cleanObject(input.visibility)

  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    videoProjectId: cleanString(input.videoProjectId),
    seriesId: cleanString(input.seriesId),
    title: cleanString(input.title) ?? 'Untitled source asset',
    description: cleanString(input.description),
    assetType: pick(SOURCE_ASSET_TYPES, input.assetType, 'raw_footage'),
    status: pick(SOURCE_ASSET_STATUSES, input.status, 'ready'),
    durationSeconds: cleanNonNegativeNumber(input.durationSeconds),
    mediaFormat: pick(SOURCE_ASSET_MEDIA_FORMATS, input.mediaFormat, 'unknown'),
    sourceUrl: cleanString(input.sourceUrl),
    storagePath: cleanString(input.storagePath),
    transcriptText: cleanString(input.transcriptText),
    transcriptAssetId: cleanString(input.transcriptAssetId),
    rights: sanitizeSourceAssetRights(input.rights),
    visibility: {
      showInClientPortal: visibility.showInClientPortal === true,
      showTranscriptInPortal: visibility.showTranscriptInPortal === true,
    },
    internalNotes: cleanString(input.internalNotes),
    clientNotes: cleanString(input.clientNotes),
    deleted: input.deleted === true,
  })
}

function sanitizeClipCandidateChecks(input: unknown): YouTubeClipCandidate['checks'] {
  const source = cleanObject(input)

  return {
    rights: stripUndefinedDeep({
      status: pick(GATE_STATUSES, cleanObject(source.rights).status, 'warning'),
      message: cleanString(cleanObject(source.rights).message) ?? 'Rights review required before this clip can be released.',
    }),
    aiDisclosure: stripUndefinedDeep({
      status: pick(GATE_STATUSES, cleanObject(source.aiDisclosure).status, 'warning'),
      message: cleanString(cleanObject(source.aiDisclosure).message) ?? 'AI disclosure review required before this clip can be released.',
    }),
  }
}

export function sanitizeYouTubeClipCandidateInput(
  input: RawInput
): Omit<YouTubeClipCandidate, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'> {
  const visibility = cleanObject(input.visibility)

  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    videoProjectId: cleanString(input.videoProjectId),
    sourceAssetId: cleanString(input.sourceAssetId) ?? '',
    title: cleanString(input.title) ?? 'Untitled clip candidate',
    summary: cleanString(input.summary),
    startSeconds: cleanNonNegativeNumber(input.startSeconds) ?? 0,
    endSeconds: cleanNonNegativeNumber(input.endSeconds) ?? 0,
    targetFormat: pick(CLIP_TARGET_FORMATS, input.targetFormat, 'vertical_short'),
    status: pick(CLIP_CANDIDATE_STATUSES, input.status, 'suggested'),
    score: cleanNonNegativeNumber(input.score),
    hook: cleanString(input.hook),
    rationale: cleanString(input.rationale),
    transcriptExcerpt: cleanString(input.transcriptExcerpt),
    checks: sanitizeClipCandidateChecks(input.checks),
    visibility: {
      showInClientPortal: visibility.showInClientPortal === true,
    },
    internalNotes: cleanString(input.internalNotes),
    deleted: input.deleted === true,
  })
}

function sanitizeProductionDraftChecks(input: unknown): YouTubeProductionDraft['checks'] {
  const source = cleanObject(input)

  return {
    claims: stripUndefinedDeep({
      status: pick(GATE_STATUSES, cleanObject(source.claims).status, 'warning'),
      message: cleanString(cleanObject(source.claims).message) ?? 'Claims review required before this draft is client-ready.',
    }),
    brand: stripUndefinedDeep({
      status: pick(GATE_STATUSES, cleanObject(source.brand).status, 'warning'),
      message: cleanString(cleanObject(source.brand).message) ?? 'Brand review required before this draft is client-ready.',
    }),
    sourceEvidence: stripUndefinedDeep({
      status: pick(GATE_STATUSES, cleanObject(source.sourceEvidence).status, 'warning'),
      message: cleanString(cleanObject(source.sourceEvidence).message) ?? 'Source evidence review required before this draft is client-ready.',
    }),
    clientApproval: stripUndefinedDeep({
      status: pick(GATE_STATUSES, cleanObject(source.clientApproval).status, 'warning'),
      message: cleanString(cleanObject(source.clientApproval).message) ?? 'Client approval required before production can proceed.',
    }),
  }
}

function sanitizeProductionDraftScenes(input: unknown): YouTubeProductionDraftScene[] {
  if (!Array.isArray(input)) return []

  return input.flatMap((item) => {
    const source = cleanObject(item)
    const label = cleanString(source.label)
    if (!label) return []

    return [stripUndefinedDeep({
      label,
      summary: cleanString(source.summary),
      targetSeconds: cleanNonNegativeNumber(source.targetSeconds),
      voiceover: cleanString(source.voiceover),
      visualNotes: cleanString(source.visualNotes),
      onScreenText: cleanString(source.onScreenText),
      sourceAssetIds: uniqueCleanStringArray(source.sourceAssetIds),
      clipCandidateIds: uniqueCleanStringArray(source.clipCandidateIds),
    })]
  })
}

export function sanitizeYouTubeProductionDraftInput(
  input: RawInput
): Omit<YouTubeProductionDraft, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'> {
  const visibility = cleanObject(input.visibility)

  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    videoProjectId: cleanString(input.videoProjectId) ?? '',
    title: cleanString(input.title) ?? 'Untitled production draft',
    draftType: pick(PRODUCTION_DRAFT_TYPES, input.draftType, 'script'),
    status: pick(PRODUCTION_DRAFT_STATUSES, input.status, 'draft'),
    versionNumber: cleanPositiveInteger(input.versionNumber),
    summary: cleanString(input.summary),
    hook: cleanString(input.hook),
    outline: uniqueCleanStringArray(input.outline),
    scriptText: cleanString(input.scriptText),
    sourceAssetIds: uniqueCleanStringArray(input.sourceAssetIds),
    clipCandidateIds: uniqueCleanStringArray(input.clipCandidateIds),
    scenes: sanitizeProductionDraftScenes(input.scenes),
    checks: sanitizeProductionDraftChecks(input.checks),
    visibility: {
      showInClientPortal: visibility.showInClientPortal === true,
      showScriptInPortal: visibility.showScriptInPortal === true,
      showScenesInPortal: visibility.showScenesInPortal === true,
    },
    internalNotes: cleanString(input.internalNotes),
    clientNotes: cleanString(input.clientNotes),
    deleted: input.deleted === true,
  })
}

function sanitizeRenderJobChecks(input: unknown): YouTubeRenderJob['checks'] {
  const source = cleanObject(input)

  return {
    sourceRights: stripUndefinedDeep({
      status: pick(GATE_STATUSES, cleanObject(source.sourceRights).status, 'warning'),
      message: cleanString(cleanObject(source.sourceRights).message) ?? 'Source rights review required before this render can be client-ready.',
    }),
    brand: stripUndefinedDeep({
      status: pick(GATE_STATUSES, cleanObject(source.brand).status, 'warning'),
      message: cleanString(cleanObject(source.brand).message) ?? 'Brand review required before this render can be client-ready.',
    }),
    captions: stripUndefinedDeep({
      status: pick(GATE_STATUSES, cleanObject(source.captions).status, 'warning'),
      message: cleanString(cleanObject(source.captions).message) ?? 'Caption review required before this render can be client-ready.',
    }),
    renderQuality: stripUndefinedDeep({
      status: pick(GATE_STATUSES, cleanObject(source.renderQuality).status, 'warning'),
      message: cleanString(cleanObject(source.renderQuality).message) ?? 'Render quality review required before this render can be client-ready.',
    }),
    clientApproval: stripUndefinedDeep({
      status: pick(GATE_STATUSES, cleanObject(source.clientApproval).status, 'warning'),
      message: cleanString(cleanObject(source.clientApproval).message) ?? 'Client approval required before publishing or release planning.',
    }),
  }
}

function sanitizeRenderTimeline(input: unknown): YouTubeRenderTimelineScene[] {
  if (!Array.isArray(input)) return []

  return input.flatMap((item) => {
    const source = cleanObject(item)
    const label = cleanString(source.label)
    if (!label) return []

    return [stripUndefinedDeep({
      label,
      summary: cleanString(source.summary),
      startSeconds: cleanNonNegativeNumber(source.startSeconds),
      endSeconds: cleanNonNegativeNumber(source.endSeconds),
      sourceAssetId: cleanString(source.sourceAssetId),
      clipCandidateId: cleanString(source.clipCandidateId),
      voiceover: cleanString(source.voiceover),
      onScreenText: cleanString(source.onScreenText),
      editNotes: cleanString(source.editNotes),
    })]
  })
}

function sanitizeRenderOutput(input: unknown): YouTubeRenderOutput | undefined {
  const source = cleanObject(input)
  if (!Object.keys(source).length) return undefined

  return stripUndefinedDeep({
    previewUrl: cleanString(source.previewUrl),
    downloadUrl: cleanString(source.downloadUrl),
    storagePath: cleanString(source.storagePath),
    youtubeVideoId: cleanString(source.youtubeVideoId),
    durationSeconds: cleanNonNegativeNumber(source.durationSeconds),
    renderPreset: cleanString(source.renderPreset),
  })
}

export function sanitizeYouTubeRenderJobInput(
  input: RawInput
): Omit<YouTubeRenderJob, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'> {
  const visibility = cleanObject(input.visibility)

  return stripUndefinedDeep({
    orgId: cleanString(input.orgId) ?? '',
    channelWorkspaceId: cleanString(input.channelWorkspaceId) ?? '',
    videoProjectId: cleanString(input.videoProjectId) ?? '',
    productionDraftId: cleanString(input.productionDraftId),
    title: cleanString(input.title) ?? 'Untitled render job',
    renderType: pick(RENDER_JOB_TYPES, input.renderType, 'full_video'),
    targetFormat: pick(RENDER_TARGET_FORMATS, input.targetFormat, 'horizontal_16_9'),
    status: pick(RENDER_JOB_STATUSES, input.status, 'planning'),
    versionNumber: cleanPositiveInteger(input.versionNumber),
    editBrief: cleanString(input.editBrief),
    sourceAssetIds: uniqueCleanStringArray(input.sourceAssetIds),
    clipCandidateIds: uniqueCleanStringArray(input.clipCandidateIds),
    timeline: sanitizeRenderTimeline(input.timeline),
    output: sanitizeRenderOutput(input.output),
    checks: sanitizeRenderJobChecks(input.checks),
    visibility: {
      showInClientPortal: visibility.showInClientPortal === true,
      showTimelineInPortal: visibility.showTimelineInPortal === true,
      showOutputsInPortal: visibility.showOutputsInPortal === true,
    },
    internalNotes: cleanString(input.internalNotes),
    clientNotes: cleanString(input.clientNotes),
    executionJobId: cleanString(input.executionJobId),
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

export function clientSafeYouTubeReleasePlan(plan: YouTubeReleasePlan): ClientSafeYouTubeReleasePlan {
  const checks = cleanObject(plan.checks)

  return stripUndefinedDeep({
    id: cleanString(plan.id),
    orgId: cleanString(plan.orgId) ?? '',
    channelWorkspaceId: cleanString(plan.channelWorkspaceId) ?? '',
    videoProjectId: cleanString(plan.videoProjectId) ?? '',
    publishingPacketId: cleanString(plan.publishingPacketId) ?? '',
    mode: pick(RELEASE_MODES, plan.mode, 'manual_handoff'),
    status: pick(RELEASE_PLAN_STATUSES, plan.status, 'draft'),
    targetVisibility: pick(PUBLISHING_VISIBILITIES, plan.targetVisibility, 'private'),
    scheduledPublishAt: cleanString(plan.scheduledPublishAt),
    publicSummary: cleanString(plan.publicSummary),
    checks: {
      approvedPacket: clientSafeGateCheck(checks.approvedPacket),
      connectedAccount: clientSafeGateCheck(checks.connectedAccount),
      privateFirst: clientSafeGateCheck(checks.privateFirst),
      clientConfirmation: clientSafeGateCheck(checks.clientConfirmation),
      scheduleWindow: clientSafeGateCheck(checks.scheduleWindow),
    },
  })
}

function clientSafeSourceAssetRights(rights: unknown): ClientSafeSourceAssetRights | undefined {
  const source = cleanObject(rights)
  if (!Object.keys(source).length) return undefined

  return stripUndefinedDeep({
    status: pick(SOURCE_ASSET_RIGHT_STATUSES, source.status, 'unknown'),
    owner: cleanString(source.owner),
    license: cleanString(source.license),
  })
}

export function clientSafeYouTubeSourceAsset(asset: YouTubeSourceAsset): ClientSafeYouTubeSourceAsset {
  return stripUndefinedDeep({
    id: cleanString(asset.id),
    orgId: cleanString(asset.orgId) ?? '',
    channelWorkspaceId: cleanString(asset.channelWorkspaceId) ?? '',
    videoProjectId: cleanString(asset.videoProjectId),
    seriesId: cleanString(asset.seriesId),
    title: cleanString(asset.title) ?? 'Untitled source asset',
    description: cleanString(asset.description),
    assetType: pick(SOURCE_ASSET_TYPES, asset.assetType, 'raw_footage'),
    status: pick(SOURCE_ASSET_STATUSES, asset.status, 'intake'),
    durationSeconds: cleanNonNegativeNumber(asset.durationSeconds),
    mediaFormat: pick(SOURCE_ASSET_MEDIA_FORMATS, asset.mediaFormat, 'unknown'),
    sourceUrl: cleanString(asset.sourceUrl),
    transcriptAssetId: cleanString(asset.transcriptAssetId),
    rights: clientSafeSourceAssetRights(asset.rights),
    clientNotes: cleanString(asset.clientNotes),
  })
}

export function clientSafeYouTubeClipCandidate(clip: YouTubeClipCandidate): ClientSafeYouTubeClipCandidate {
  const checks = cleanObject(clip.checks)

  return stripUndefinedDeep({
    id: cleanString(clip.id),
    orgId: cleanString(clip.orgId) ?? '',
    channelWorkspaceId: cleanString(clip.channelWorkspaceId) ?? '',
    videoProjectId: cleanString(clip.videoProjectId),
    sourceAssetId: cleanString(clip.sourceAssetId) ?? '',
    title: cleanString(clip.title) ?? 'Untitled clip candidate',
    summary: cleanString(clip.summary),
    startSeconds: cleanNonNegativeNumber(clip.startSeconds) ?? 0,
    endSeconds: cleanNonNegativeNumber(clip.endSeconds) ?? 0,
    targetFormat: pick(CLIP_TARGET_FORMATS, clip.targetFormat, 'vertical_short'),
    status: pick(CLIP_CANDIDATE_STATUSES, clip.status, 'suggested'),
    hook: cleanString(clip.hook),
    transcriptExcerpt: cleanString(clip.transcriptExcerpt),
    checks: {
      rights: clientSafeGateCheck(checks.rights),
      aiDisclosure: clientSafeGateCheck(checks.aiDisclosure),
    },
  })
}

function clientSafeProductionDraftScene(scene: unknown): ClientSafeProductionDraftScene | undefined {
  const source = cleanObject(scene)
  const label = cleanString(source.label)
  if (!label) return undefined

  return stripUndefinedDeep({
    label,
    summary: cleanString(source.summary),
    targetSeconds: cleanNonNegativeNumber(source.targetSeconds),
    voiceover: cleanString(source.voiceover),
    visualNotes: cleanString(source.visualNotes),
    onScreenText: cleanString(source.onScreenText),
  })
}

export function clientSafeYouTubeProductionDraft(
  draft: YouTubeProductionDraft
): ClientSafeYouTubeProductionDraft {
  const checks = cleanObject(draft.checks)
  const visibility = cleanObject(draft.visibility)

  return stripUndefinedDeep({
    id: cleanString(draft.id),
    orgId: cleanString(draft.orgId) ?? '',
    channelWorkspaceId: cleanString(draft.channelWorkspaceId) ?? '',
    videoProjectId: cleanString(draft.videoProjectId) ?? '',
    title: cleanString(draft.title) ?? 'Untitled production draft',
    draftType: pick(PRODUCTION_DRAFT_TYPES, draft.draftType, 'script'),
    status: pick(PRODUCTION_DRAFT_STATUSES, draft.status, 'draft'),
    versionNumber: cleanPositiveInteger(draft.versionNumber),
    summary: cleanString(draft.summary),
    hook: cleanString(draft.hook),
    outline: uniqueCleanStringArray(draft.outline),
    scriptText: visibility.showScriptInPortal === true ? cleanString(draft.scriptText) : undefined,
    scenes: visibility.showScenesInPortal === true
      ? (Array.isArray(draft.scenes) ? draft.scenes.map(clientSafeProductionDraftScene).filter(isDefined) : [])
      : [],
    checks: {
      claims: clientSafeGateCheck(checks.claims),
      brand: clientSafeGateCheck(checks.brand),
      sourceEvidence: clientSafeGateCheck(checks.sourceEvidence),
      clientApproval: clientSafeGateCheck(checks.clientApproval),
    },
    clientNotes: cleanString(draft.clientNotes),
  })
}

function clientSafeRenderTimelineScene(scene: unknown): ClientSafeRenderTimelineScene | undefined {
  const source = cleanObject(scene)
  const label = cleanString(source.label)
  if (!label) return undefined

  return stripUndefinedDeep({
    label,
    summary: cleanString(source.summary),
    startSeconds: cleanNonNegativeNumber(source.startSeconds),
    endSeconds: cleanNonNegativeNumber(source.endSeconds),
    voiceover: cleanString(source.voiceover),
    onScreenText: cleanString(source.onScreenText),
    editNotes: cleanString(source.editNotes),
  })
}

function clientSafeRenderOutput(output: unknown): ClientSafeRenderOutput | undefined {
  const source = cleanObject(output)
  if (!Object.keys(source).length) return undefined

  const safeOutput = stripUndefinedDeep({
    previewUrl: cleanString(source.previewUrl),
    downloadUrl: cleanString(source.downloadUrl),
    durationSeconds: cleanNonNegativeNumber(source.durationSeconds),
  })

  return Object.keys(safeOutput).length ? safeOutput : undefined
}

export function clientSafeYouTubeRenderJob(job: YouTubeRenderJob): ClientSafeYouTubeRenderJob {
  const checks = cleanObject(job.checks)
  const visibility = cleanObject(job.visibility)

  return stripUndefinedDeep({
    id: cleanString(job.id),
    orgId: cleanString(job.orgId) ?? '',
    channelWorkspaceId: cleanString(job.channelWorkspaceId) ?? '',
    videoProjectId: cleanString(job.videoProjectId) ?? '',
    productionDraftId: cleanString(job.productionDraftId),
    title: cleanString(job.title) ?? 'Untitled render job',
    renderType: pick(RENDER_JOB_TYPES, job.renderType, 'full_video'),
    targetFormat: pick(RENDER_TARGET_FORMATS, job.targetFormat, 'horizontal_16_9'),
    status: pick(RENDER_JOB_STATUSES, job.status, 'planning'),
    versionNumber: cleanPositiveInteger(job.versionNumber),
    editBrief: cleanString(job.editBrief),
    timeline: visibility.showTimelineInPortal === true
      ? (Array.isArray(job.timeline) ? job.timeline.map(clientSafeRenderTimelineScene).filter(isDefined) : [])
      : [],
    output: visibility.showOutputsInPortal === true ? clientSafeRenderOutput(job.output) : undefined,
    checks: {
      sourceRights: clientSafeGateCheck(checks.sourceRights),
      brand: clientSafeGateCheck(checks.brand),
      captions: clientSafeGateCheck(checks.captions),
      renderQuality: clientSafeGateCheck(checks.renderQuality),
      clientApproval: clientSafeGateCheck(checks.clientApproval),
    },
    clientNotes: cleanString(job.clientNotes),
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
