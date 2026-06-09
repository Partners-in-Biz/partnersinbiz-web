import type {
  YouTubeChannelWorkspace,
  YouTubeGateCheck,
  YouTubePublishingPacket,
  YouTubeReleasePlan,
  YouTubeSourceAsset,
} from './types'
import type { PublishOptions } from '@/lib/social/providers/base'

export const YOUTUBE_UPLOAD_QUOTA_UNITS = 1600

const PACKET_CHECK_KEYS: Array<keyof YouTubePublishingPacket['checks']> = [
  'rights',
  'aiDisclosure',
  'madeForKids',
  'metadata',
  'thumbnail',
  'captions',
  'approval',
  'connectedAccount',
]

export type YouTubePublishReadinessResult = {
  ready: boolean
  mode: YouTubeReleasePlan['mode']
  blockers: string[]
  quotaLimited: boolean
  manualHandoffRequired: boolean
}

export type YouTubePublishErrorClassification = {
  type: 'quota' | 'auth' | 'rate_limit' | 'retryable' | 'fatal'
  retryable: boolean
  status: 'quota_limited' | 'needs_reauth' | 'rate_limited' | 'failed'
  message: string
}

export type YouTubeUploadOptions = PublishOptions & {
  privacyStatus: 'private' | 'unlisted' | 'public'
  targetVisibility: 'private' | 'unlisted' | 'public'
  tags: string[]
  selfDeclaredMadeForKids: boolean
  containsSyntheticMedia?: boolean
  aiDisclosureNotes?: string
  publishAt?: string
}

type EvaluateInput = {
  channel: YouTubeChannelWorkspace
  packet: YouTubePublishingPacket
  releasePlan: YouTubeReleasePlan
  videoAsset?: YouTubeSourceAsset | null
}

function gateStatus(check?: YouTubeGateCheck): YouTubeGateCheck['status'] | undefined {
  return check?.status
}

function gateMessage(check?: YouTubeGateCheck): string {
  return check?.message || 'Check failed.'
}

function hasApprovalEvidence(packet: YouTubePublishingPacket): boolean {
  return Boolean(packet.approvedBy && packet.approvedAt && packet.approvedSnapshotHash)
}

function videoAssetUrl(videoAsset?: YouTubeSourceAsset | null): string | undefined {
  if (!videoAsset || videoAsset.deleted === true) return undefined
  if (videoAsset.status !== 'ready') return undefined
  if (videoAsset.assetType !== 'rendered_video' && videoAsset.assetType !== 'raw_footage') return undefined
  return typeof videoAsset.sourceUrl === 'string' && videoAsset.sourceUrl.trim()
    ? videoAsset.sourceUrl.trim()
    : undefined
}

export function evaluateYouTubePublishReadiness(input: EvaluateInput): YouTubePublishReadinessResult {
  const { channel, packet, releasePlan, videoAsset } = input
  const blockers: string[] = []
  let quotaLimited = false
  let manualHandoffRequired = false

  if (releasePlan.mode === 'manual_handoff') {
    manualHandoffRequired = true
    blockers.push('Release plan is manual handoff; YouTube API upload is not allowed for this plan.')
  }

  if (releasePlan.deleted === true) blockers.push('Release plan is deleted.')
  if (!['ready', 'scheduled'].includes(releasePlan.status)) {
    blockers.push('Release plan must be ready or scheduled before YouTube upload.')
  }

  if (channel.status !== 'active') {
    blockers.push('YouTube channel workspace must be active before upload.')
  }
  const allowedModes = channel.publishingReadiness?.allowedModes ?? channel.defaultPublishingPolicy?.allowedModes ?? []
  if (!allowedModes.includes(releasePlan.mode)) {
    blockers.push('Release mode is not allowed by channel readiness or publishing policy.')
  }

  for (const [key, check] of Object.entries(releasePlan.checks ?? {}) as Array<[string, YouTubeGateCheck]>) {
    if (check?.status === 'block') blockers.push(`Release plan check ${key} is blocking: ${gateMessage(check)}`)
  }

  if (packet.deleted === true) blockers.push('Publishing packet is deleted.')
  if (packet.status !== 'approved') blockers.push('Publishing packet must be approved before YouTube upload.')
  if (!hasApprovalEvidence(packet)) {
    blockers.push('Publishing packet approval evidence is required before YouTube upload.')
  }

  for (const key of PACKET_CHECK_KEYS) {
    const check = packet.checks?.[key]
    if (gateStatus(check) === 'block') {
      blockers.push(`Publishing packet check ${key} is blocking: ${gateMessage(check)}`)
    }
    if (!check || gateStatus(check) === 'warning') {
      blockers.push(`Publishing packet check ${key} must pass before YouTube upload.`)
    }
  }

  if (!channel.connectedAccountId || channel.publishingReadiness?.accountStatus !== 'connected') {
    blockers.push('Connected YouTube account is required before YouTube upload.')
  }
  if (channel.publishingReadiness?.accountStatus === 'needs_reauth' || channel.publishingReadiness?.accountStatus === 'revoked') {
    blockers.push('Connected YouTube account needs reauthorization before upload.')
  }
  if (channel.publishingReadiness?.apiProjectStatus === 'quota_limited') {
    quotaLimited = true
    blockers.push('YouTube API project is quota limited.')
  }
  if (channel.publishingReadiness?.apiProjectStatus === 'blocked' || channel.publishingReadiness?.readiness === 'blocked') {
    blockers.push('YouTube publishing is blocked for this channel.')
  }
  if (channel.publishingReadiness?.apiProjectStatus === 'audit_required') {
    blockers.push('YouTube API compliance audit must be resolved before upload.')
  }
  if (channel.publishingReadiness?.apiProjectStatus === 'unverified_private_only' && releasePlan.targetVisibility !== 'private') {
    blockers.push('Unverified YouTube API projects must remain private.')
  }

  if (releasePlan.mode === 'private_api_upload' && !['private_upload_ready', 'scheduled_publish_ready'].includes(channel.publishingReadiness?.readiness ?? '')) {
    blockers.push('Channel readiness must be private_upload_ready before private API upload.')
  }
  if (releasePlan.mode === 'scheduled_api_publish' && channel.publishingReadiness?.readiness !== 'scheduled_publish_ready') {
    blockers.push('Channel readiness must be scheduled_publish_ready before scheduled publish.')
  }
  if (releasePlan.mode === 'scheduled_api_publish') {
    if (typeof releasePlan.scheduledPublishAt !== 'string' || Number.isNaN(Date.parse(releasePlan.scheduledPublishAt))) {
      blockers.push('A valid scheduled publish timestamp is required before scheduled publish.')
    }
    if (releasePlan.targetVisibility !== 'public') {
      blockers.push('Scheduled YouTube publish must target public visibility.')
    }
  }

  const remaining = channel.publishingReadiness?.quotaUnitsRemaining
  if (typeof remaining === 'number' && remaining < YOUTUBE_UPLOAD_QUOTA_UNITS) {
    quotaLimited = true
    blockers.push(`YouTube upload requires at least ${YOUTUBE_UPLOAD_QUOTA_UNITS} quota units.`)
  }

  if (!videoAssetUrl(videoAsset)) {
    blockers.push('A ready rendered video asset URL is required before YouTube upload.')
  }

  if (releasePlan.uploadPrivacyStatus !== 'private') {
    blockers.push('YouTube API upload must start as private for the private-first audit trail.')
  }

  return {
    ready: blockers.length === 0,
    mode: releasePlan.mode,
    blockers,
    quotaLimited,
    manualHandoffRequired,
  }
}

export function classifyYouTubePublishError(error: unknown): YouTubePublishErrorClassification {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()

  if (normalized.includes('quota') || normalized.includes('daily limit exceeded')) {
    return { type: 'quota', retryable: false, status: 'quota_limited', message }
  }
  if (normalized.includes('unauthorized') || normalized.includes('invalid_grant') || normalized.includes('401')) {
    return { type: 'auth', retryable: false, status: 'needs_reauth', message }
  }
  if (normalized.includes('rate') || normalized.includes('429')) {
    return { type: 'rate_limit', retryable: true, status: 'rate_limited', message }
  }
  if (normalized.includes('500') || normalized.includes('502') || normalized.includes('503') || normalized.includes('timeout')) {
    return { type: 'retryable', retryable: true, status: 'failed', message }
  }

  return { type: 'fatal', retryable: false, status: 'failed', message }
}

function selectedTitle(packet: YouTubePublishingPacket): string {
  return packet.titleOptions.find((option) => option.selected)?.text
    ?? packet.titleOptions[0]?.text
    ?? 'Untitled YouTube video'
}

export function buildYouTubeUploadOptions(input: {
  packet: YouTubePublishingPacket
  releasePlan: YouTubeReleasePlan
  videoAsset: YouTubeSourceAsset
}): YouTubeUploadOptions {
  const url = videoAssetUrl(input.videoAsset)
  if (!url) throw new Error('A ready rendered video asset URL is required before YouTube upload.')

  return {
    title: selectedTitle(input.packet).slice(0, 100),
    text: input.packet.description ?? '',
    mediaUrls: [url],
    privacyStatus: 'private',
    targetVisibility: input.releasePlan.targetVisibility,
    publishAt: typeof input.releasePlan.scheduledPublishAt === 'string'
      ? input.releasePlan.scheduledPublishAt
      : undefined,
    tags: input.packet.tags,
    selfDeclaredMadeForKids: input.packet.selfDeclaredMadeForKids === true,
    containsSyntheticMedia: input.packet.containsSyntheticMedia,
    aiDisclosureNotes: input.packet.aiDisclosureNotes,
  }
}
