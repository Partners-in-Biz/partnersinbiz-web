import { buildYouTubeStudioProjectModel } from '@/lib/chat-context/adapters/youtubeStudio'
import type {
  YouTubeAnalyticsSnapshot, YouTubeChannelWorkspace, YouTubeProductionDraft,
  YouTubePublishingPacket, YouTubeReleasePlan, YouTubeRenderJob, YouTubeSourceAsset,
  YouTubeVideoProject,
} from '@/lib/youtube-studio/types'

const channel = {
  id: 'channel-1', orgId: 'org-1', title: 'Acme TV', status: 'active', connectedAccountId: 'account-1',
  publishingReadiness: { accountStatus: 'connected', apiProjectStatus: 'verified', readiness: 'private_upload_ready', defaultUploadPrivacy: 'private', allowedModes: ['private_api_upload'], quotaUnitsRemaining: 5000, lastCheckedAt: '2026-07-13T09:00:00Z' },
  defaultPublishingPolicy: { allowedModes: ['private_api_upload'], defaultVisibility: 'private', privateFirstRequired: true, publicPublishRequiresAdmin: true, publicPublishRequiresClientConfirmation: true },
  defaultApprovalPolicy: {}, contentPillars: [], avoidTopics: [], aiDisclosureDefaults: { syntheticMediaLikely: false }, deleted: false,
} as YouTubeChannelWorkspace & { id: string }

const video = { id: 'video-1', orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Launch film', videoType: 'long_form', status: 'publish_ready', objective: 'Launch', source: { intakeType: 'client_request' }, linked: {}, approvalPolicy: {}, deleted: false } as YouTubeVideoProject & { id: string }

function model(overrides: Partial<Parameters<typeof buildYouTubeStudioProjectModel>[0]> = {}) {
  return buildYouTubeStudioProjectModel({ channel, video, productionDrafts: [], sourceAssets: [], renderJobs: [], clipCandidates: [], packets: [], releasePlans: [], analytics: [], role: 'client', now: new Date('2026-07-13T10:00:00Z'), ...overrides })
}

describe('YouTube Studio chat cockpit', () => {
  it('presents channel readiness and keeps publish-ready distinct from live', () => {
    const result = model()
    expect(result.context.href).toBe('/portal/youtube-studio/editor/video-1')
    expect(result.pulse).toEqual(expect.objectContaining({ label: 'Publish ready', headline: 'Acme TV is ready for private upload' }))
    expect(result.artifacts.find((item) => item.resourceType === 'video_project')).toEqual(expect.objectContaining({ state: 'review', statusLabel: 'Publish ready' }))
    expect(result.artifacts.some((item) => item.state === 'published')).toBe(false)
    expect(JSON.stringify(result)).toContain('Private first')
  })

  it('uses the authorized admin deep link and bounds persisted labels', () => {
    const huge = 'A'.repeat(1000)
    const result = model({ href: '/admin/org/org-1/youtube-studio/video-1', video: { ...video, title: huge }, channel: { ...channel, title: huge } })
    expect(result.context.href).toBe('/admin/org/org-1/youtube-studio/video-1')
    expect(result.context.label.length).toBeLessThanOrEqual(160)
    expect(result.artifacts[0].title.length).toBeLessThanOrEqual(160)
    expect(result.groups.find((group) => group.id === 'channel')?.items[0].label.length).toBeLessThanOrEqual(160)
  })

  it('uses the canonical admin editor route when no authorized href is supplied', () => {
    expect(model({ role: 'admin', href: undefined }).context.href).toBe('/admin/org/org-1/youtube-studio/editor/video-1')
  })

  it('omits unsafe persisted source and render preview URLs', () => {
    const sourceAssets = [
      { id: 'thumb-unsafe', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Unsafe thumbnail', assetType: 'thumbnail', status: 'ready', mediaFormat: 'horizontal', sourceUrl: 'javascript:alert(1)', deleted: false },
      { id: 'thumb-oversized', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Oversized thumbnail', assetType: 'thumbnail', status: 'ready', mediaFormat: 'horizontal', sourceUrl: `https://cdn.test/${'a'.repeat(2100)}`, deleted: false },
    ] as Array<YouTubeSourceAsset & { id: string }>
    const renderJobs = [{ id: 'render-unsafe', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Unsafe render', renderType: 'full_video', targetFormat: 'horizontal_16_9', status: 'approved', versionNumber: 1, sourceAssetIds: [], clipCandidateIds: [], timeline: [], checks: {}, output: { previewUrl: 'data:text/html,bad' }, visibility: { showInClientPortal: true, showOutputsInPortal: true }, deleted: false }] as Array<YouTubeRenderJob & { id: string }>
    const result = model({ sourceAssets, renderJobs })
    expect(result.artifacts.find((item) => item.resourceId === 'thumb-unsafe')?.preview).toEqual({ kind: 'none' })
    expect(result.artifacts.find((item) => item.resourceId === 'render-unsafe')?.preview).toEqual({ kind: 'none' })
    expect(result.artifacts.find((item) => item.resourceId === 'thumb-oversized')?.preview).toEqual({ kind: 'none' })
    expect(JSON.stringify(result)).not.toMatch(/javascript:|data:text/)
  })

  it('bounds persisted asset titles in rights-attention details', () => {
    const sourceAssets = [{ id: 'rights-long', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'R'.repeat(1000), assetType: 'raw_footage', status: 'needs_rights_review', mediaFormat: 'horizontal', rights: { status: 'needs_review' }, deleted: false }] as Array<YouTubeSourceAsset & { id: string }>
    const detail = model({ sourceAssets }).attention.find((item) => item.id === 'rights:rights-long')?.detail
    expect(detail?.length).toBeLessThanOrEqual(240)
    expect(detail).not.toContain('R'.repeat(241))
  })

  it('summarises scripts, thumbnails, renders, clip packs, and release plans as client artifacts', () => {
    const productionDrafts = [{ id: 'script-1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Launch script', draftType: 'script', status: 'client_review', versionNumber: 2, outline: [], sourceAssetIds: [], clipCandidateIds: [], scenes: [], checks: {}, deleted: false }] as Array<YouTubeProductionDraft & { id: string }>
    const sourceAssets = [{ id: 'thumb-1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Thumbnail A', assetType: 'thumbnail', status: 'ready', mediaFormat: 'horizontal', sourceUrl: 'https://cdn.test/thumb.jpg', deleted: false }] as Array<YouTubeSourceAsset & { id: string }>
    const renderJobs = [{ id: 'render-1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Final render', renderType: 'full_video', targetFormat: 'horizontal_16_9', status: 'qa_review', versionNumber: 1, sourceAssetIds: [], clipCandidateIds: [], timeline: [], checks: {}, output: { previewUrl: 'https://cdn.test/render.mp4' }, deleted: false }] as Array<YouTubeRenderJob & { id: string }>
    const packets = [{ id: 'packet-1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', versionNumber: 1, status: 'client_review', titleOptions: [{ text: 'Launch film', selected: true }], tags: [], chapters: [], visibility: 'private', checks: {}, deleted: false }] as Array<YouTubePublishingPacket & { id: string }>
    const releasePlans = [{ id: 'release-1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', publishingPacketId: 'packet-1', mode: 'private_api_upload', status: 'ready', uploadPrivacyStatus: 'private', targetVisibility: 'public', checks: { clientConfirmation: { status: 'block', message: 'Client confirmation required.' } }, deleted: false }] as Array<YouTubeReleasePlan & { id: string }>
    const result = model({ productionDrafts, sourceAssets, renderJobs, packets, releasePlans })
    expect(result.artifacts.map((item) => item.resourceType)).toEqual(expect.arrayContaining(['production_draft', 'thumbnail', 'render', 'release_plan']))
    expect(result.groups.find((group) => group.id === 'deliverables')?.items.map((item) => item.label)).toEqual(expect.arrayContaining(['Launch script', 'Thumbnail A', 'Final render']))
    expect(result.attention).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'publish-confirmation:release-1', state: 'needs_approval' })]))
    expect(result.pulse.next?.label).toBe('Publishing packet approval required')
  })

  it.each([
    [{ accountStatus: 'needs_reauth' }, 'Reconnect YouTube'],
    [{ apiProjectStatus: 'quota_limited' }, 'YouTube quota is limited'],
  ])('surfaces readiness blockers without exposing a bypass action', (readiness, label) => {
    const result = model({ channel: { ...channel, publishingReadiness: { ...channel.publishingReadiness!, ...readiness } } })
    expect(result.attention).toEqual(expect.arrayContaining([expect.objectContaining({ label })]))
    expect(result.artifacts.flatMap((item) => item.actions).some((action) => action.id === 'publish')).toBe(false)
  })

  it('surfaces rights and review blockers with safe client wording', () => {
    const sourceAssets = [{ id: 'asset-1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Licensed clip', assetType: 'raw_footage', status: 'needs_rights_review', mediaFormat: 'horizontal', rights: { status: 'needs_review', notes: 'secret vendor dispute' }, deleted: false }] as Array<YouTubeSourceAsset & { id: string }>
    const result = model({ sourceAssets, video: { ...video, status: 'client_review' } })
    expect(result.attention).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Rights review required', state: 'blocked' }),
      expect.objectContaining({ label: 'Video review required', state: 'review' }),
    ]))
    expect(JSON.stringify(result)).not.toContain('secret vendor dispute')
  })

  it('includes concise analytics only when fresh, visible, and relevant', () => {
    const fresh = [{ id: 'fresh', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', periodStart: '2026-07-01', periodEnd: '2026-07-13', source: 'youtube_analytics_api', sourceFreshness: 'fresh', metrics: { views: 1200, impressionsCtr: 4.8, averageViewPercentage: 61 }, recommendations: [], clientSummary: 'Strong opening retention.', importedAt: '2026-07-13T08:00:00Z', deleted: false }] as Array<YouTubeAnalyticsSnapshot & { id: string }>
    expect(model({ analytics: fresh }).pulse.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'views', value: 1200 })]))
    const stale = [{ ...fresh[0], id: 'stale', importedAt: '2026-06-01T08:00:00Z' }]
    expect(model({ analytics: stale }).pulse.metrics.some((metric) => metric.id === 'views')).toBe(false)
  })

  it('hides analytics from clients when channel analytics visibility is disabled', () => {
    const analytics = [{ id: 'fresh', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', periodStart: '2026-07-01', periodEnd: '2026-07-13', source: 'youtube_analytics_api', sourceFreshness: 'fresh', metrics: { views: 1200 }, recommendations: [], importedAt: '2026-07-13T08:00:00Z', deleted: false }] as Array<YouTubeAnalyticsSnapshot & { id: string }>
    const hiddenChannel = { ...channel, visibility: { showAnalytics: false } }

    expect(model({ channel: hiddenChannel, analytics }).pulse.metrics.some((metric) => metric.id === 'views')).toBe(false)
    expect(model({ channel: hiddenChannel, analytics, role: 'admin' }).pulse.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'views' })]))
  })

  it.each([
    [{ accountStatus: 'not_connected' }, 'Connect YouTube'],
    [{ apiProjectStatus: 'audit_required' }, 'YouTube API review required'],
    [{ apiProjectStatus: 'blocked' }, 'YouTube publishing is unavailable'],
    [{ readiness: 'not_ready' }, 'Finish YouTube publishing setup'],
    [{ readiness: 'blocked' }, 'YouTube publishing is unavailable'],
  ])('derives channel readiness from account, API, and readiness state', (readiness, label) => {
    const result = model({ channel: { ...channel, publishingReadiness: { ...channel.publishingReadiness!, ...readiness } } })
    expect(result.attention).toEqual(expect.arrayContaining([expect.objectContaining({ label, state: 'blocked' })]))
    expect(result.groups.find((group) => group.id === 'channel')?.items[0].state).toBe('blocked')
    expect(result.pulse.next).toEqual(expect.objectContaining({ label, state: 'blocked' }))
  })

  it.each([
    [{ packetStatus: 'client_review' }, 'Publishing packet approval required'],
    [{ packetCheck: 'approval' }, 'Publishing packet checks required'],
    [{ planCheck: 'approvedPacket' }, 'Publishing packet approval required'],
    [{ planCheck: 'privateFirst' }, 'Private-first release check required'],
    [{ planCheck: 'clientConfirmation' }, 'Confirm publishing when ready'],
    [{ planCheck: 'scheduleWindow', mode: 'scheduled_api_publish' }, 'Publishing schedule needs attention'],
    [{ publishLock: true }, 'Publishing approval is locked'],
  ])('maps release policy blockers to safe cockpit attention', (scenario, label) => {
    const checks = { rights: { status: 'pass' }, aiDisclosure: { status: 'pass' }, madeForKids: { status: 'pass' }, metadata: { status: 'pass' }, thumbnail: { status: 'pass' }, captions: { status: 'pass' }, approval: { status: scenario.packetCheck === 'approval' ? 'block' : 'pass', message: 'internal secret' }, connectedAccount: { status: 'pass' } }
    const approval = { status: 'approved', decidedBy: 'user-1', decidedAt: '2026-07-13T09:00:00Z', snapshotHash: 'hash-1' }
    const packets = [{ id: 'packet-policy', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', versionNumber: 1, status: scenario.packetStatus ?? 'approved', titleOptions: [{ text: 'Launch film', selected: true }], tags: [], chapters: [], visibility: 'private', checks, approvedBy: 'user-1', approvedAt: '2026-07-13T09:00:00Z', approvedSnapshotHash: 'hash-1', immutableAuditRecordIds: ['audit-1'], approvalState: scenario.publishLock ? { internalStatus: 'approved', clientStatus: 'approved', changeRequestStatus: 'none', internalApproval: approval, clientApproval: approval, publishLock: { locked: true, reasons: ['confidential reason'] } } : undefined, deleted: false }] as unknown as Array<YouTubePublishingPacket & { id: string }>
    const releaseChecks = { approvedPacket: { status: scenario.planCheck === 'approvedPacket' ? 'block' : 'pass', message: 'secret packet detail' }, connectedAccount: { status: 'pass' }, privateFirst: { status: scenario.planCheck === 'privateFirst' ? 'block' : 'pass', message: 'secret privacy detail' }, clientConfirmation: { status: scenario.planCheck === 'clientConfirmation' ? 'block' : 'pass', message: 'secret confirmation detail' }, scheduleWindow: { status: scenario.planCheck === 'scheduleWindow' ? 'block' : 'pass', message: 'secret schedule detail' } }
    const releasePlans = [{ id: 'release-policy', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', publishingPacketId: 'packet-policy', mode: scenario.mode ?? 'private_api_upload', status: 'ready', uploadPrivacyStatus: 'private', targetVisibility: scenario.mode ? 'public' : 'private', scheduledPublishAt: scenario.mode ? 'invalid' : undefined, checks: releaseChecks, deleted: false }] as unknown as Array<YouTubeReleasePlan & { id: string }>

    const scenarioChannel = scenario.mode ? { ...channel, publishingReadiness: { ...channel.publishingReadiness!, allowedModes: ['private_api_upload', 'scheduled_api_publish'] as Array<'private_api_upload' | 'scheduled_api_publish'> } } : channel
    const result = model({ channel: scenarioChannel, packets, releasePlans })
    expect(result.attention).toEqual(expect.arrayContaining([expect.objectContaining({ label })]))
    expect(result.pulse.next?.label).toBe(label)
    expect(JSON.stringify(result)).not.toMatch(/internal secret|confidential reason|secret packet detail|secret privacy detail|secret confirmation detail|secret schedule detail/)
  })

  it('blocks public release for an unverified API project and disallowed release mode', () => {
    const packets = [{ id: 'packet-1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', versionNumber: 1, status: 'approved', titleOptions: [], tags: [], chapters: [], visibility: 'private', checks: {}, deleted: false }] as Array<YouTubePublishingPacket & { id: string }>
    const releasePlans = [{ id: 'release-1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', publishingPacketId: 'packet-1', mode: 'scheduled_api_publish', status: 'ready', uploadPrivacyStatus: 'private', targetVisibility: 'public', scheduledPublishAt: '2026-07-14T10:00:00Z', checks: { approvedPacket: { status: 'pass' }, connectedAccount: { status: 'pass' }, privateFirst: { status: 'pass' }, clientConfirmation: { status: 'pass' }, scheduleWindow: { status: 'pass' } }, deleted: false }] as Array<YouTubeReleasePlan & { id: string }>
    const result = model({ channel: { ...channel, publishingReadiness: { ...channel.publishingReadiness!, apiProjectStatus: 'unverified_private_only' } }, packets, releasePlans })

    expect(result.attention).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Public publishing is not available' }),
      expect.objectContaining({ label: 'Release mode is not available' }),
    ]))
    expect(result.pulse.next?.state).toBe('blocked')
  })

  it('surfaces missing configured admin approval without leaking internal approval data', () => {
    const packets = [{ id: 'packet-1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', versionNumber: 1, status: 'approved', titleOptions: [], tags: [], chapters: [], visibility: 'private', checks: {}, approvalState: { internalApproval: { status: 'pending', notes: 'private admin note' } }, deleted: false }] as unknown as Array<YouTubePublishingPacket & { id: string }>
    const releasePlans = [{ id: 'release-1', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', publishingPacketId: 'packet-1', mode: 'private_api_upload', status: 'ready', uploadPrivacyStatus: 'private', targetVisibility: 'private', checks: { approvedPacket: { status: 'pass' }, connectedAccount: { status: 'pass' }, privateFirst: { status: 'pass' }, clientConfirmation: { status: 'pass' }, scheduleWindow: { status: 'pass' } }, deleted: false }] as Array<YouTubeReleasePlan & { id: string }>
    const result = model({ packets, releasePlans })

    expect(result.attention).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Admin publishing approval required' })]))
    expect(JSON.stringify(result)).not.toContain('private admin note')
  })

  it('mirrors executor packet and connection safeguards in safe cockpit attention', () => {
    const packets = [{ id: 'packet-guarded', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', versionNumber: 1, status: 'approved', isLatestVersion: false, supersededByPacketId: 'packet-secret', titleOptions: [], tags: [], chapters: [], visibility: 'private', checks: { rights: { status: 'pass' }, aiDisclosure: { status: 'warning', message: 'secret warning' } }, approvalState: { internalStatus: 'pending', clientStatus: 'pending', changeRequestStatus: 'open' }, immutableAuditRecordIds: [], deleted: false }] as unknown as Array<YouTubePublishingPacket & { id: string }>
    const releasePlans = [{ id: 'release-guarded', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', publishingPacketId: 'packet-guarded', mode: 'private_api_upload', status: 'ready', uploadPrivacyStatus: 'private', targetVisibility: 'private', checks: { approvedPacket: { status: 'pass' }, connectedAccount: { status: 'block', message: 'secret account detail' }, privateFirst: { status: 'pass' }, clientConfirmation: { status: 'pass' }, scheduleWindow: { status: 'pass' } }, deleted: false }] as Array<YouTubeReleasePlan & { id: string }>
    const result = model({ channel: { ...channel, status: 'paused' }, packets, releasePlans })

    expect(result.attention).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Channel publishing is paused' }),
      expect.objectContaining({ label: 'Reconnect YouTube for this release' }),
      expect.objectContaining({ label: 'Publishing packet checks required' }),
      expect.objectContaining({ label: 'Use the latest publishing packet' }),
      expect.objectContaining({ label: 'Admin publishing approval required' }),
      expect.objectContaining({ label: 'Client publishing approval required' }),
      expect.objectContaining({ label: 'Resolve requested publishing changes' }),
      expect.objectContaining({ label: 'Publishing audit record required' }),
    ]))
    expect(result.groups.find((group) => group.id === 'channel')?.items[0].state).toBe('blocked')
    expect(result.pulse.next).toEqual(expect.objectContaining({ label: 'Channel publishing is paused', state: 'blocked' }))
    expect(JSON.stringify(result)).not.toMatch(/packet-secret|secret warning|secret account detail/)
  })

  it('does not expose render output previews unless the client output flag is enabled', () => {
    const baseRender = { id: 'render-private', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Private render', renderType: 'full_video', targetFormat: 'horizontal_16_9', status: 'approved', versionNumber: 1, sourceAssetIds: [], clipCandidateIds: [], timeline: [], checks: {}, output: { previewUrl: 'https://cdn.test/private.mp4' }, visibility: { showInClientPortal: true, showOutputsInPortal: false }, deleted: false } as YouTubeRenderJob & { id: string }
    expect(model({ renderJobs: [baseRender] }).artifacts.find((item) => item.resourceId === 'render-private')?.preview).toEqual({ kind: 'none' })
    expect(model({ renderJobs: [{ ...baseRender, visibility: { showInClientPortal: true, showOutputsInPortal: true } }] }).artifacts.find((item) => item.resourceId === 'render-private')?.preview).toEqual({ kind: 'video', url: 'https://cdn.test/private.mp4' })
  })

  it.each([
    [{ mode: 'manual_handoff' }, 'Manual publishing handoff required'],
    [{ planStatus: 'draft' }, 'Release plan is not ready'],
    [{ genericCheck: true }, 'Release plan checks required'],
    [{ noAsset: true }, 'Ready video output required'],
    [{ readiness: 'not_ready' }, 'Channel is not ready for this upload'],
    [{ mode: 'scheduled_api_publish', readiness: 'private_upload_ready' }, 'Scheduled publishing is not ready'],
    [{ mode: 'scheduled_api_publish', targetVisibility: 'unlisted' }, 'Scheduled publishing must be public'],
  ])('maps executor release blockers without exposing raw gate messages', (scenario, label) => {
    const approval = { status: 'approved', decidedBy: 'user-1', decidedAt: '2026-07-13T09:00:00Z', snapshotHash: 'hash-1' }
    const pass = { status: 'pass' as const }
    const packets = [{ id: 'packet-ready', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', videoAssetId: 'video-output', versionNumber: 1, status: 'approved', isLatestVersion: true, titleOptions: [], tags: [], chapters: [], visibility: 'private', checks: { rights: pass, aiDisclosure: pass, madeForKids: pass, metadata: pass, thumbnail: pass, captions: pass, approval: pass, connectedAccount: pass }, approvalState: { internalStatus: 'approved', clientStatus: 'approved', changeRequestStatus: 'none', internalApproval: approval, clientApproval: approval }, immutableAuditRecordIds: ['audit-1'], deleted: false }] as unknown as Array<YouTubePublishingPacket & { id: string }>
    const mode = scenario.mode ?? 'private_api_upload'
    const releasePlans = [{ id: 'release-ready', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', publishingPacketId: 'packet-ready', mode, status: scenario.planStatus ?? 'ready', uploadPrivacyStatus: 'private', targetVisibility: scenario.targetVisibility ?? (mode === 'scheduled_api_publish' ? 'public' : 'private'), scheduledPublishAt: mode === 'scheduled_api_publish' ? '2026-07-14T10:00:00Z' : undefined, checks: { approvedPacket: pass, connectedAccount: pass, privateFirst: pass, clientConfirmation: pass, scheduleWindow: pass, ...(scenario.genericCheck ? { customGate: { status: 'block', message: 'raw secret gate' } } : {}) }, deleted: false }] as unknown as Array<YouTubeReleasePlan & { id: string }>
    const sourceAssets = scenario.noAsset ? [] : [{ id: 'video-output', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Final', assetType: 'rendered_video', status: 'ready', mediaFormat: 'horizontal', sourceUrl: 'https://cdn.test/final.mp4', deleted: false }] as Array<YouTubeSourceAsset & { id: string }>
    const allowedModes = ['private_api_upload', 'scheduled_api_publish', 'manual_handoff'] as Array<'private_api_upload' | 'scheduled_api_publish' | 'manual_handoff'>
    const scenarioChannel = { ...channel, publishingReadiness: { ...channel.publishingReadiness!, readiness: scenario.readiness ?? (mode === 'scheduled_api_publish' ? 'scheduled_publish_ready' : 'private_upload_ready'), allowedModes }, defaultPublishingPolicy: { ...channel.defaultPublishingPolicy, allowedModes } }
    const result = model({ channel: scenarioChannel, packets, releasePlans, sourceAssets })
    expect(result.attention).toEqual(expect.arrayContaining([expect.objectContaining({ label })]))
    expect(JSON.stringify(result)).not.toContain('raw secret gate')
  })

  it.each([
    ['missing', []],
    ['not ready', [{ id: 'selected-output', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Selected output', assetType: 'rendered_video', status: 'processing', mediaFormat: 'horizontal', sourceUrl: 'https://cdn.test/selected.mp4', deleted: false }]],
  ])('does not let an unrelated ready render satisfy a %s packet-selected asset', (_case, selectedAssets) => {
    const pass = { status: 'pass' as const }
    const packets = [{ id: 'packet-lineage', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', videoAssetId: 'selected-output', versionNumber: 1, status: 'approved', titleOptions: [], tags: [], chapters: [], visibility: 'private', checks: { rights: pass, aiDisclosure: pass, madeForKids: pass, metadata: pass, thumbnail: pass, captions: pass, approval: pass, connectedAccount: pass }, approvedBy: 'user-1', approvedAt: '2026-07-13T09:00:00Z', approvedSnapshotHash: 'hash', immutableAuditRecordIds: ['audit'], deleted: false }] as unknown as Array<YouTubePublishingPacket & { id: string }>
    const releasePlans = [{ id: 'release-lineage', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', publishingPacketId: 'packet-lineage', mode: 'private_api_upload', status: 'ready', uploadPrivacyStatus: 'private', targetVisibility: 'private', checks: { approvedPacket: pass, connectedAccount: pass, privateFirst: pass, clientConfirmation: pass, scheduleWindow: pass }, deleted: false }] as Array<YouTubeReleasePlan & { id: string }>
    const unrelated = { id: 'unrelated-output', orgId: 'org-1', channelWorkspaceId: 'channel-1', videoProjectId: 'video-1', title: 'Unrelated output', assetType: 'rendered_video', status: 'ready', mediaFormat: 'horizontal', sourceUrl: 'https://cdn.test/unrelated.mp4', deleted: false }
    const sourceAssets = [unrelated, ...selectedAssets] as Array<YouTubeSourceAsset & { id: string }>

    expect(model({ packets, releasePlans, sourceAssets }).attention).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Ready video output required' })]))
  })
})
