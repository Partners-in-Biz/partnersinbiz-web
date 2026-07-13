import { adminDb } from '@/lib/firebase/admin'
import type { ApiRole } from '@/lib/api/types'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type { ChatArtifactSummary, ChatContextReadModel, ContextDisplayState } from '@/lib/chat-context/types'
import { safePreviewUrl } from '@/lib/chat-context/safeUrl'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { YOUTUBE_COLLECTIONS } from '@/lib/youtube-studio/api'
import { buildWorkQueue, WORK_QUEUE_GROUPS } from '@/lib/youtube-studio/work-queue'
import {
  hasImmutableYouTubePacketAudit,
  hasOpenYouTubePacketChangeRequests,
  hasYouTubeClientApprovalEvidence,
  hasYouTubeInternalApprovalEvidence,
  classifyYouTubeSafePublishBlockers,
  YOUTUBE_PACKET_CHECK_KEYS,
} from '@/lib/youtube-studio/publishing'
import type {
  YouTubeAnalyticsSnapshot, YouTubeChannelWorkspace, YouTubeClipCandidate,
  YouTubeProductionDraft, YouTubePublishingPacket, YouTubeReleasePlan,
  YouTubeRenderJob, YouTubeSourceAsset, YouTubeVideoProject,
} from '@/lib/youtube-studio/types'

const CHILD_LIMIT = 20
const ANALYTICS_FRESH_MS = 72 * 60 * 60 * 1000

type Identified<T> = T & { id: string }

export interface YouTubeStudioProjectModelInput {
  channel: Identified<YouTubeChannelWorkspace>
  video: Identified<YouTubeVideoProject>
  productionDrafts: Array<Identified<YouTubeProductionDraft>>
  sourceAssets: Array<Identified<YouTubeSourceAsset>>
  renderJobs: Array<Identified<YouTubeRenderJob>>
  clipCandidates: Array<Identified<YouTubeClipCandidate>>
  packets: Array<Identified<YouTubePublishingPacket>>
  releasePlans: Array<Identified<YouTubeReleasePlan>>
  analytics: Array<Identified<YouTubeAnalyticsSnapshot>>
  role: ApiRole
  now?: Date
  href?: string
}

function dateString(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value && typeof value === 'object') {
    try { return (value as { toDate?: () => Date }).toDate?.().toISOString() } catch { return undefined }
  }
  return undefined
}

function timestamp(value: unknown): number { const date = dateString(value); return date ? Date.parse(date) : 0 }
function titleCase(value: string): string { return value.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase()) }
function boundedLabel(value: unknown, fallback: string): string {
  return (typeof value === 'string' && value.trim() ? value.trim() : fallback).slice(0, 160)
}
function hrefFor(videoId: string, role: ApiRole, orgId: string): string {
  return role === 'client'
    ? `/portal/youtube-studio/editor/${encodeURIComponent(videoId)}`
    : `/admin/org/${encodeURIComponent(orgId)}/youtube-studio/editor/${encodeURIComponent(videoId)}`
}

function videoState(status: YouTubeVideoProject['status']): ContextDisplayState {
  if (status === 'live') return 'published'
  if (status === 'scheduled') return 'waiting'
  if (status === 'publish_ready' || status === 'internal_review' || status === 'client_review') return 'review'
  if (status === 'blocked' || status === 'changes_requested') return 'blocked'
  if (status === 'archived') return 'archived'
  if (status === 'production') return 'running'
  return 'ready'
}

function visible<T extends { deleted: boolean; visibility?: { showInClientPortal?: boolean } }>(records: Array<Identified<T>>, role: ApiRole): Array<Identified<T>> {
  return records.filter((record) => !record.deleted && (role !== 'client' || record.visibility?.showInClientPortal !== false)).slice(0, CHILD_LIMIT)
}

function artifact(input: {
  id: string; type: string; title: string; kind: ChatArtifactSummary['artifactKind']; state: ContextDisplayState;
  status: string; href: string; preview?: ChatArtifactSummary['preview']; updatedAt?: unknown
}): ChatArtifactSummary {
  return {
    id: `youtube_studio:${input.type}:${encodeURIComponent(input.id)}`, studioKind: 'youtube_studio', resourceType: input.type,
    resourceId: input.id, title: boundedLabel(input.title, 'Untitled artifact'), artifactKind: input.kind, state: input.state, statusLabel: boundedLabel(titleCase(input.status), 'Unknown'),
    preview: input.preview ?? { kind: 'none' }, updatedAt: dateString(input.updatedAt), href: input.href,
    actions: [{ id: 'open', label: 'Open in YouTube Studio', href: input.href }],
  }
}

export function buildYouTubeStudioProjectModel(input: YouTubeStudioProjectModelInput): ChatContextReadModel {
  const { channel, video, role } = input
  const now = input.now ?? new Date()
  const href = input.href ?? hrefFor(video.id, role, video.orgId)
  const drafts = visible(input.productionDrafts, role)
  const assets = visible(input.sourceAssets, role)
  const renders = visible(input.renderJobs, role)
  const clips = visible(input.clipCandidates, role)
  const packets = input.packets
    .filter((packet) => !packet.deleted && (role !== 'client' || video.visibility?.showPublishingPacket !== false))
    .slice(0, CHILD_LIMIT)
  const plans = visible(input.releasePlans, role)
  const showAnalytics = role !== 'client' || channel.visibility?.showAnalytics !== false
  const analytics = showAnalytics
    ? visible(input.analytics, role).filter((snapshot) => snapshot.visibility?.showInClientPortal !== false)
    : []
  const queue = buildWorkQueue({ videos: [video], packets, productionDrafts: drafts, renderJobs: renders })
  const readiness = channel.publishingReadiness
  const artifacts: ChatArtifactSummary[] = [artifact({ id: video.id, type: 'video_project', title: video.title, kind: 'video', state: videoState(video.status), status: video.status, href, updatedAt: video.updatedAt })]
  for (const draft of drafts) artifacts.push(artifact({ id: draft.id, type: 'production_draft', title: draft.title, kind: 'document', state: draft.status === 'client_review' ? 'review' : draft.status === 'approved' ? 'complete' : draft.status === 'blocked' ? 'blocked' : 'ready', status: draft.status, href, updatedAt: draft.updatedAt }))
  for (const asset of assets.filter((item) => item.assetType === 'thumbnail')) { const previewUrl = safePreviewUrl(asset.sourceUrl); artifacts.push(artifact({ id: asset.id, type: 'thumbnail', title: asset.title, kind: 'image', state: asset.status === 'ready' ? 'complete' : asset.status === 'blocked' || asset.status === 'needs_rights_review' ? 'blocked' : 'running', status: asset.status, href, preview: previewUrl ? { kind: 'image', url: previewUrl } : undefined, updatedAt: asset.updatedAt })) }
  for (const render of renders) { const previewUrl = safePreviewUrl(render.output?.previewUrl); artifacts.push(artifact({ id: render.id, type: render.renderType === 'clip_pack' ? 'clip_pack' : 'render', title: render.title, kind: render.renderType === 'clip_pack' ? 'collection' : 'video', state: render.status === 'approved' ? 'complete' : render.status === 'qa_review' ? 'review' : render.status === 'blocked' ? 'blocked' : render.status === 'rendering' ? 'running' : 'ready', status: render.status, href, preview: (role !== 'client' || render.visibility?.showOutputsInPortal === true) && previewUrl ? { kind: 'video', url: previewUrl } : undefined, updatedAt: render.updatedAt })) }
  if (clips.length) artifacts.push(artifact({ id: video.id, type: 'clip_candidates', title: `${clips.length} clip candidate${clips.length === 1 ? '' : 's'}`, kind: 'collection', state: clips.some((clip) => clip.status === 'needs_review') ? 'review' : 'ready', status: 'clip pack', href }))
  for (const packet of packets) artifacts.push(artifact({ id: packet.id, type: 'publishing_packet', title: packet.titleOptions.find((option) => option.selected)?.text ?? packet.titleOptions[0]?.text ?? 'Publishing packet', kind: 'release', state: packet.status === 'published' ? 'published' : packet.status === 'client_review' ? 'review' : packet.status === 'approved' ? 'complete' : packet.status === 'blocked' ? 'blocked' : 'ready', status: packet.status, href }))
  for (const plan of plans) artifacts.push(artifact({ id: plan.id, type: 'release_plan', title: plan.publicSummary || 'Release plan', kind: 'release', state: plan.status === 'published' ? 'published' : plan.status === 'scheduled' ? 'waiting' : plan.status === 'blocked' ? 'blocked' : plan.status === 'ready' ? 'review' : 'ready', status: plan.status, href, updatedAt: plan.updatedAt }))

  const attention: ChatContextReadModel['attention'] = []
  const addAttention = (item: ChatContextReadModel['attention'][number]) => {
    if (!attention.some((existing) => existing.id === item.id)) attention.push(item)
  }
  if (channel.status !== 'active') addAttention({ id: 'channel-inactive', label: channel.status === 'paused' ? 'Channel publishing is paused' : 'Channel publishing is unavailable', state: 'blocked', detail: 'The channel workspace must be active before publishing can continue.', href })
  if (readiness?.accountStatus === 'not_connected' || !channel.connectedAccountId) addAttention({ id: 'connect-account', label: 'Connect YouTube', state: 'blocked', detail: 'Connect the channel before preparing an upload.', href, actions: [{ id: 'open-connections', label: 'Open channel connection', href }] })
  if (readiness?.accountStatus === 'needs_reauth' || readiness?.accountStatus === 'revoked') attention.push({ id: 'reauth', label: 'Reconnect YouTube', state: 'blocked', detail: 'The channel connection needs to be renewed before upload.', href, actions: [{ id: 'open-connections', label: 'Open channel connection', href }] })
  if (readiness?.apiProjectStatus === 'quota_limited' || (typeof readiness?.quotaUnitsRemaining === 'number' && readiness.quotaUnitsRemaining < 1600)) attention.push({ id: 'quota', label: 'YouTube quota is limited', state: 'blocked', detail: 'Upload capacity is currently limited. No publish attempt will be made.', href })
  if (readiness?.apiProjectStatus === 'audit_required') addAttention({ id: 'api-review', label: 'YouTube API review required', state: 'blocked', detail: 'The API project must complete its required review before publishing can continue.', href })
  if (readiness?.apiProjectStatus === 'blocked' || readiness?.readiness === 'blocked' || readiness?.accountStatus === 'blocked') addAttention({ id: 'publishing-unavailable', label: 'YouTube publishing is unavailable', state: 'blocked', detail: 'Publishing is currently blocked for this channel. Open YouTube Studio for the next setup step.', href })
  if (readiness && ['not_ready', 'manual_only'].includes(readiness.readiness) && readiness.accountStatus === 'connected') addAttention({ id: 'publishing-setup', label: 'Finish YouTube publishing setup', state: 'blocked', detail: 'The channel is connected, but API publishing is not ready yet.', href })
  for (const asset of assets.filter((item) => item.status === 'needs_rights_review' || item.rights?.status === 'needs_review' || item.rights?.status === 'blocked')) attention.push({ id: `rights:${asset.id}`, label: 'Rights review required', state: 'blocked', detail: `${boundedLabel(asset.title, 'This asset')} needs rights clearance before release.`, href })
  if (video.status === 'client_review' || video.clientReview?.status === 'requested') attention.push({ id: `video-review:${video.id}`, label: 'Video review required', state: 'review', detail: 'Review the current video and record your decision in YouTube Studio.', href, actions: [{ id: 'review', label: 'Review video', href }] })
  for (const plan of plans) {
    const packet = packets.find((item) => item.id === plan.publishingPacketId)
    const videoAsset = input.sourceAssets.find((asset) => asset.id === packet?.videoAssetId)
    if (plan.checks?.connectedAccount?.status === 'block') addAttention({ id: `release-account:${plan.id}`, label: 'Reconnect YouTube for this release', state: 'blocked', detail: 'The release plan needs a valid connected YouTube account before upload.', href })
    if (!packet || packet.status !== 'approved' || plan.checks?.approvedPacket?.status !== 'pass') addAttention({ id: `packet-approval:${plan.id}`, label: 'Publishing packet approval required', state: 'needs_approval', detail: 'The release packet must be approved before an upload can start.', href, actions: [{ id: 'review-release', label: 'Review release plan', href }] })
    if (packet && YOUTUBE_PACKET_CHECK_KEYS.some((key) => !packet.checks?.[key] || ['block', 'warning'].includes(packet.checks[key].status))) addAttention({ id: `packet-checks:${plan.id}`, label: 'Publishing packet checks required', state: 'blocked', detail: 'Every required release check must pass before upload.', href })
    if (packet && (packet.isLatestVersion === false || packet.supersededByPacketId)) addAttention({ id: `latest-packet:${plan.id}`, label: 'Use the latest publishing packet', state: 'blocked', detail: 'This release references an older packet version. Select the latest approved version.', href })
    if (channel.defaultPublishingPolicy.publicPublishRequiresAdmin && packet && !hasYouTubeInternalApprovalEvidence(packet)) addAttention({ id: `admin-approval:${plan.id}`, label: 'Admin publishing approval required', state: 'needs_approval', detail: 'An administrator must approve this release before publishing can continue.', href })
    if (channel.defaultPublishingPolicy.publicPublishRequiresClientConfirmation && packet && !hasYouTubeClientApprovalEvidence(packet)) addAttention({ id: `client-approval:${plan.id}`, label: 'Client publishing approval required', state: 'needs_approval', detail: 'Client approval must be recorded before publishing can continue.', href })
    if (packet && hasOpenYouTubePacketChangeRequests(packet)) addAttention({ id: `open-changes:${plan.id}`, label: 'Resolve requested publishing changes', state: 'blocked', detail: 'Open change requests must be resolved before publishing can continue.', href })
    if (packet?.approvalState?.publishLock?.locked) addAttention({ id: `publish-lock:${plan.id}`, label: 'Publishing approval is locked', state: 'blocked', detail: 'The approval lock must be cleared in YouTube Studio before publishing can continue.', href })
    if (packet && !hasImmutableYouTubePacketAudit(packet)) addAttention({ id: `packet-audit:${plan.id}`, label: 'Publishing audit record required', state: 'blocked', detail: 'The approved release needs its immutable audit record before upload.', href })
    const allowedModes = readiness?.allowedModes ?? channel.defaultPublishingPolicy.allowedModes
    if (!allowedModes.includes(plan.mode)) addAttention({ id: `release-mode:${plan.id}`, label: 'Release mode is not available', state: 'blocked', detail: 'This channel is not configured for the selected release mode.', href })
    if (readiness?.apiProjectStatus === 'unverified_private_only' && plan.targetVisibility !== 'private') addAttention({ id: `private-only:${plan.id}`, label: 'Public publishing is not available', state: 'blocked', detail: 'This API project can upload privately, but cannot publish publicly yet.', href })
    if (plan.checks?.privateFirst?.status !== 'pass' || (channel.defaultPublishingPolicy.privateFirstRequired && plan.uploadPrivacyStatus !== 'private')) addAttention({ id: `private-first:${plan.id}`, label: 'Private-first release check required', state: 'blocked', detail: 'The first API upload must remain private for review and audit.', href })
    if (plan.status === 'ready' && plan.checks?.clientConfirmation?.status !== 'pass') addAttention({ id: `publish-confirmation:${plan.id}`, label: 'Confirm publishing when ready', state: 'needs_approval', detail: 'Publish-ready is not live. Public release still requires the configured client confirmation and admin approval.', href, actions: [{ id: 'review-release', label: 'Review release plan', href }] })
    const scheduleInvalid = plan.mode === 'scheduled_api_publish' && (typeof plan.scheduledPublishAt !== 'string' || Number.isNaN(Date.parse(plan.scheduledPublishAt)))
    if (plan.checks?.scheduleWindow?.status === 'block' || scheduleInvalid) addAttention({ id: `schedule:${plan.id}`, label: 'Publishing schedule needs attention', state: 'blocked', detail: 'Choose a valid release window before scheduling the public publish.', href })
    if (packet) {
      const safeBlockers = classifyYouTubeSafePublishBlockers({ channel, packet, releasePlan: plan, videoAsset })
      const safeDetails: Record<(typeof safeBlockers)[number], { label: string; detail: string }> = {
        manual_handoff: { label: 'Manual publishing handoff required', detail: 'This release is configured for a reviewed manual handoff instead of API upload.' },
        release_plan_not_ready: { label: 'Release plan is not ready', detail: 'Move the release plan to ready or scheduled before publishing.' },
        release_plan_checks: { label: 'Release plan checks required', detail: 'One or more release-plan checks must be resolved before publishing.' },
        ready_video_required: { label: 'Ready video output required', detail: 'A ready final video output is required before upload.' },
        private_upload_not_ready: { label: 'Channel is not ready for this upload', detail: 'Finish private-upload setup before starting this release.' },
        scheduled_publish_not_ready: { label: 'Scheduled publishing is not ready', detail: 'Finish scheduled-publishing setup before choosing this mode.' },
        scheduled_publish_must_be_public: { label: 'Scheduled publishing must be public', detail: 'Scheduled API publishing requires public target visibility.' },
      }
      for (const code of safeBlockers) addAttention({ id: `safe-policy:${code}:${plan.id}`, label: safeDetails[code].label, state: 'blocked', detail: safeDetails[code].detail, href })
    }
  }

  const latestAnalytics = analytics
    .filter((snapshot) => snapshot.sourceFreshness === 'fresh' && (!snapshot.videoProjectId || snapshot.videoProjectId === video.id))
    .sort((a, b) => timestamp(b.importedAt ?? b.updatedAt) - timestamp(a.importedAt ?? a.updatedAt))[0]
  const analyticsIsFresh = latestAnalytics && now.getTime() - timestamp(latestAnalytics.importedAt ?? latestAnalytics.updatedAt) <= ANALYTICS_FRESH_MS
  const metrics: ChatContextReadModel['pulse']['metrics'] = [
    { id: 'deliverables', label: 'Deliverables', value: artifacts.length - 1 },
    { id: 'attention', label: 'Needs attention', value: attention.length },
  ]
  if (analyticsIsFresh && latestAnalytics) {
    if (typeof latestAnalytics.metrics.views === 'number') metrics.push({ id: 'views', label: 'Views', value: latestAnalytics.metrics.views })
    if (typeof latestAnalytics.metrics.impressionsCtr === 'number') metrics.push({ id: 'ctr', label: 'CTR', value: `${latestAnalytics.metrics.impressionsCtr}%` })
    if (typeof latestAnalytics.metrics.averageViewPercentage === 'number') metrics.push({ id: 'retention', label: 'Average viewed', value: `${latestAnalytics.metrics.averageViewPercentage}%` })
  }
  const channelTitle = boundedLabel(channel.title, 'YouTube channel')
  const readinessHeadline = boundedLabel(readiness?.accountStatus === 'connected' && ['private_upload_ready', 'scheduled_publish_ready'].includes(readiness.readiness)
    ? `${channelTitle} is ready for private upload`
    : `${channelTitle} needs publishing setup`, 'YouTube publishing setup')
  const next = attention[0]

  return {
    context: { kind: 'studio_artifact', id: `youtube_studio:video_project:${encodeURIComponent(video.id)}`, orgId: video.orgId, label: boundedLabel(video.title, 'Untitled video'), icon: 'youtube_studio', href },
    pulse: { label: titleCase(video.status), headline: readinessHeadline, metrics, next: next ? { id: next.id, label: next.label, state: next.state, detail: next.detail, href: next.href, actions: next.actions } : { id: 'continue', label: video.status === 'publish_ready' ? 'Review release readiness' : 'Continue production', state: 'ready', detail: 'Private first; public publishing remains confirmation-gated.', href } },
    groups: [
      { id: 'channel', label: 'Channel readiness', items: [{ id: channel.id, label: channelTitle, state: channel.status === 'active' && readiness?.accountStatus === 'connected' && readiness.apiProjectStatus === 'verified' && ['private_upload_ready', 'scheduled_publish_ready'].includes(readiness.readiness) ? 'ready' : 'blocked', detail: `Private first · ${titleCase(readiness?.readiness ?? 'not_ready')}`, href }] },
      ...WORK_QUEUE_GROUPS.map((group) => ({ id: group.key, label: group.label, items: queue[group.key].map((item) => ({ id: item.key, label: boundedLabel(item.title, 'Untitled work item'), state: item.group === 'needs_input' ? 'needs_input' as const : item.group === 'in_production' ? 'running' as const : item.group === 'scheduled_live' ? (item.video?.status === 'live' ? 'published' as const : 'waiting' as const) : 'review' as const, href })) })).filter((group) => group.items.length > 0),
      { id: 'deliverables', label: 'Deliverables', items: artifacts.slice(1).map((item) => ({ id: item.id, label: item.title, state: item.state, detail: item.statusLabel, updatedAt: item.updatedAt, href: item.href })) },
    ],
    artifacts, attention, activity: [], capabilities: ['view', 'review', ...(role === 'admin' || role === 'ai' ? ['manage_production'] : [])], asOf: now.toISOString(),
  }
}

async function boundedChildren<T extends { orgId: string; videoProjectId?: string }>(collection: string, orgId: string, videoProjectId: string): Promise<Array<Identified<T>>> {
  const snap = await adminDb.collection(collection).where('orgId', '==', orgId).where('videoProjectId', '==', videoProjectId).orderBy('updatedAt', 'desc').limit(CHILD_LIMIT).get()
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Identified<T>)).filter((record) => record.orgId === orgId && record.videoProjectId === videoProjectId).slice(0, CHILD_LIMIT)
}

export const youtubeStudioChatContextAdapter: ChatContextAdapter = {
  async resolve({ id, artifactId, user }) {
    if (!id.startsWith('youtube_studio:video_project:')) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    let videoId: string
    try { videoId = decodeURIComponent(id.slice('youtube_studio:video_project:'.length)) } catch { return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' } }
    if (!videoId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const videoSnap = await adminDb.collection(YOUTUBE_COLLECTIONS.videos).doc(videoId).get()
    const video = videoSnap.exists ? videoSnap.data() as YouTubeVideoProject | undefined : undefined
    if (!video || video.deleted) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    if (user.role === 'client' && video.visibility?.showInClientPortal === false) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const refs = await resolveContextReferences([{ type: 'studio_artifact', id }], user)
    const ref = refs.find((item) => item.type === 'studio_artifact' && item.id === id)
    if (!ref?.orgId || ref.orgId !== video.orgId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const channelSnap = await adminDb.collection(YOUTUBE_COLLECTIONS.channels).doc(video.channelWorkspaceId).get()
    const channel = channelSnap.exists ? channelSnap.data() as YouTubeChannelWorkspace | undefined : undefined
    if (!channel || channel.deleted || channel.orgId !== ref.orgId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    if (user.role === 'client' && channel.visibility?.showInClientPortal === false) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    let [productionDrafts, sourceAssets, renderJobs, clipCandidates, packets, releasePlans, analytics] = await Promise.all([
      boundedChildren<YouTubeProductionDraft>(YOUTUBE_COLLECTIONS.productionDrafts, ref.orgId, videoId),
      boundedChildren<YouTubeSourceAsset>(YOUTUBE_COLLECTIONS.sourceAssets, ref.orgId, videoId),
      boundedChildren<YouTubeRenderJob>(YOUTUBE_COLLECTIONS.renderJobs, ref.orgId, videoId),
      boundedChildren<YouTubeClipCandidate>(YOUTUBE_COLLECTIONS.clipCandidates, ref.orgId, videoId),
      boundedChildren<YouTubePublishingPacket>(YOUTUBE_COLLECTIONS.packets, ref.orgId, videoId),
      boundedChildren<YouTubeReleasePlan>(YOUTUBE_COLLECTIONS.releasePlans, ref.orgId, videoId),
      boundedChildren<YouTubeAnalyticsSnapshot>(YOUTUBE_COLLECTIONS.analytics, ref.orgId, videoId),
    ])
    if (artifactId && artifactId !== id) {
      const match = /^youtube_studio:(production_draft|thumbnail|render|clip_pack|publishing_packet|release_plan):(.+)$/.exec(artifactId)
      const collection = match && ({ production_draft: YOUTUBE_COLLECTIONS.productionDrafts, thumbnail: YOUTUBE_COLLECTIONS.sourceAssets, render: YOUTUBE_COLLECTIONS.renderJobs, clip_pack: YOUTUBE_COLLECTIONS.renderJobs, publishing_packet: YOUTUBE_COLLECTIONS.packets, release_plan: YOUTUBE_COLLECTIONS.releasePlans } as const)[match[1] as 'production_draft']
      if (match && collection) {
        const childSnap = await adminDb.collection(collection).doc(match[2]).get()
        const child = childSnap.exists ? { id: match[2], ...childSnap.data() } as Record<string, unknown> : undefined
        if (child && child.orgId === ref.orgId && child.videoProjectId === videoId && child.deleted !== true) {
          if (match[1] === 'production_draft') productionDrafts = [child as unknown as Identified<YouTubeProductionDraft>]
          if (match[1] === 'thumbnail') sourceAssets = [child as unknown as Identified<YouTubeSourceAsset>]
          if (match[1] === 'render' || match[1] === 'clip_pack') renderJobs = [child as unknown as Identified<YouTubeRenderJob>]
          if (match[1] === 'publishing_packet') packets = [child as unknown as Identified<YouTubePublishingPacket>]
          if (match[1] === 'release_plan') releasePlans = [child as unknown as Identified<YouTubeReleasePlan>]
        }
      }
    }
    return { ok: true, model: buildYouTubeStudioProjectModel({ channel: { id: video.channelWorkspaceId, ...channel }, video: { id: videoId, ...video }, productionDrafts, sourceAssets, renderJobs, clipCandidates, packets, releasePlans, analytics, role: user.role, href: ref.href }) }
  },
}
