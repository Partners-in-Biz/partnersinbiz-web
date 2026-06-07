import type {
  YouTubeApprovalPolicy,
  YouTubeChannelStatus,
  YouTubeChannelWorkspace,
  YouTubeGateCheck,
  YouTubePublishingPacket,
  YouTubePublishingPolicy,
  YouTubeSeries,
  YouTubeSeriesCadence,
  YouTubeSeriesFormat,
  YouTubeSeriesStatus,
  YouTubeSourceType,
  YouTubeVideoProject,
  YouTubeVideoStatus,
  YouTubeVideoType,
} from './types'

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

export type ClientSafeYouTubeGateCheck = Pick<YouTubeGateCheck, 'status' | 'message'>

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

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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

export function serializeYouTubeRecord<T extends object>(id: string, data: Record<string, unknown>): T & { id: string } {
  return { id, ...(JSON.parse(JSON.stringify(data)) as T) }
}

export function clientSafeYouTubeChannelWorkspace(
  channel: YouTubeChannelWorkspace
): ClientSafeYouTubeChannelWorkspace {
  return stripUndefinedDeep({
    id: channel.id,
    orgId: channel.orgId,
    title: channel.title,
    youtubeChannelId: channel.youtubeChannelId,
    youtubeHandle: channel.youtubeHandle,
    status: channel.status,
    contentPillars: cleanStringArray(channel.contentPillars),
    audienceNotes: channel.audienceNotes,
    clientNotes: channel.clientNotes,
    aiDisclosureDefaults: channel.aiDisclosureDefaults
      ? {
          syntheticMediaLikely: channel.aiDisclosureDefaults.syntheticMediaLikely === true,
          notes: channel.aiDisclosureDefaults.notes,
        }
      : undefined,
    visibility: channel.visibility
      ? {
          showInClientPortal: channel.visibility.showInClientPortal,
          showAnalytics: channel.visibility.showAnalytics,
        }
      : undefined,
  })
}

export function clientSafeYouTubeSeries(series: YouTubeSeries): ClientSafeYouTubeSeries {
  return stripUndefinedDeep({
    id: series.id,
    orgId: series.orgId,
    channelWorkspaceId: series.channelWorkspaceId,
    name: series.name,
    objective: series.objective,
    audience: series.audience,
    format: pick(SERIES_FORMATS, series.format, 'mixed'),
    cadence: pick(SERIES_CADENCES, series.cadence, 'ad_hoc'),
    targetDurationSeconds: series.targetDurationSeconds,
    episodeTemplate: {
      hook: series.episodeTemplate?.hook,
      sections: Array.isArray(series.episodeTemplate?.sections)
        ? series.episodeTemplate.sections.map((section) => ({
            label: section.label,
            targetSeconds: section.targetSeconds,
            notes: section.notes,
          }))
        : [],
      outro: series.episodeTemplate?.outro,
    },
    styleGuide: {
      visualNotes: series.styleGuide?.visualNotes,
      thumbnailNotes: series.styleGuide?.thumbnailNotes,
      captionNotes: series.styleGuide?.captionNotes,
      introOutroRules: series.styleGuide?.introOutroRules,
    },
    season: series.season,
    status: pick(SERIES_STATUSES, series.status, 'active'),
  })
}

export function clientSafeYouTubeVideoProject(video: YouTubeVideoProject): ClientSafeYouTubeVideoProject {
  return stripUndefinedDeep({
    id: video.id,
    orgId: video.orgId,
    channelWorkspaceId: video.channelWorkspaceId,
    seriesId: video.seriesId,
    title: video.title,
    workingTitle: video.workingTitle,
    videoType: video.videoType,
    status: video.status,
    objective: video.objective,
    targetAudience: video.targetAudience,
    targetDurationSeconds: video.targetDurationSeconds,
    source: {
      intakeType: pick(SOURCE_TYPES, video.source?.intakeType, 'manual'),
    },
    clientReview: video.clientReview
      ? {
          status: video.clientReview.status,
          notes: video.clientReview.notes,
        }
      : undefined,
    clientNotes: video.clientNotes,
    visibility: video.visibility
      ? {
          showInClientPortal: video.visibility.showInClientPortal,
          showAnalytics: video.visibility.showAnalytics,
          showPublishingPacket: video.visibility.showPublishingPacket,
        }
      : undefined,
  })
}

function clientSafeGateCheck(check?: YouTubeGateCheck): ClientSafeYouTubeGateCheck | undefined {
  if (!check) return undefined
  return stripUndefinedDeep({
    status: check.status,
    message: check.message,
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
  return stripUndefinedDeep({
    id: packet.id,
    orgId: packet.orgId,
    channelWorkspaceId: packet.channelWorkspaceId,
    videoProjectId: packet.videoProjectId,
    versionNumber: packet.versionNumber,
    status: packet.status,
    titleOptions: Array.isArray(packet.titleOptions)
      ? packet.titleOptions.map(clientSafePacketTitleOption).filter(isDefined)
      : [],
    description: packet.description,
    tags: cleanStringArray(packet.tags),
    chapters: Array.isArray(packet.chapters)
      ? packet.chapters.map(clientSafePacketChapter).filter(isDefined)
      : [],
    visibility: packet.visibility,
    selfDeclaredMadeForKids: packet.selfDeclaredMadeForKids,
    containsSyntheticMedia: packet.containsSyntheticMedia,
    aiDisclosureNotes: packet.aiDisclosureNotes,
    checks: {
      rights: clientSafeGateCheck(packet.checks?.rights),
      aiDisclosure: clientSafeGateCheck(packet.checks?.aiDisclosure),
      madeForKids: clientSafeGateCheck(packet.checks?.madeForKids),
      metadata: clientSafeGateCheck(packet.checks?.metadata),
      thumbnail: clientSafeGateCheck(packet.checks?.thumbnail),
      captions: clientSafeGateCheck(packet.checks?.captions),
      approval: clientSafeGateCheck(packet.checks?.approval),
    },
  })
}
