import {
  evaluateYouTubePublishReadiness,
  classifyYouTubePublishError,
  buildYouTubeUploadOptions,
  YOUTUBE_UPLOAD_QUOTA_UNITS,
} from '@/lib/youtube-studio/publishing'
import type { YouTubeChannelWorkspace, YouTubePublishingPacket, YouTubeReleasePlan, YouTubeSourceAsset } from '@/lib/youtube-studio/types'

const pass = { status: 'pass' as const, message: 'ok' }

function channel(overrides: Partial<YouTubeChannelWorkspace> = {}): YouTubeChannelWorkspace {
  return {
    id: 'channel-1',
    orgId: 'org-1',
    title: 'Channel',
    status: 'active',
    connectedAccountId: 'account-1',
    publishingReadiness: {
      accountStatus: 'connected',
      apiProjectStatus: 'verified',
      readiness: 'scheduled_publish_ready',
      defaultUploadPrivacy: 'private',
      allowedModes: ['manual_handoff', 'private_api_upload', 'scheduled_api_publish'],
      quotaDailyLimit: 10000,
      quotaUnitsRemaining: YOUTUBE_UPLOAD_QUOTA_UNITS,
    },
    defaultApprovalPolicy: {
      requireInternalBriefApproval: false,
      requireClientBriefApproval: false,
      requireClientScriptApproval: false,
      requireClientDraftApproval: false,
      requireClientThumbnailApproval: false,
      requireClientPublishConfirmation: true,
      requireInternalPublishApproval: true,
    },
    defaultPublishingPolicy: {
      allowedModes: ['manual_handoff', 'private_api_upload', 'scheduled_api_publish'],
      defaultVisibility: 'private',
      privateFirstRequired: true,
      publicPublishRequiresAdmin: true,
      publicPublishRequiresClientConfirmation: true,
    },
    contentPillars: [],
    avoidTopics: [],
    aiDisclosureDefaults: { syntheticMediaLikely: false },
    deleted: false,
    ...overrides,
  }
}

function packet(overrides: Partial<YouTubePublishingPacket> = {}): YouTubePublishingPacket {
  return {
    id: 'packet-1',
    orgId: 'org-1',
    channelWorkspaceId: 'channel-1',
    videoProjectId: 'video-1',
    versionNumber: 1,
    status: 'approved',
    titleOptions: [{ text: 'Approved title', selected: true }],
    description: 'Approved description',
    tags: ['growth', 'ops'],
    chapters: [],
    thumbnailAssetId: 'thumb-1',
    captionAssetId: 'caption-1',
    videoAssetId: 'asset-1',
    visibility: 'private',
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: false,
    checks: {
      rights: pass,
      aiDisclosure: pass,
      madeForKids: pass,
      metadata: pass,
      thumbnail: pass,
      captions: pass,
      approval: pass,
      connectedAccount: pass,
    },
    approvedBy: 'admin-1',
    approvedAt: 'date',
    approvedSnapshotHash: 'hash',
    approvalState: {
      internalStatus: 'approved',
      clientStatus: 'approved',
      changeRequestStatus: 'none',
      internalApproval: {
        status: 'approved',
        decidedBy: 'admin-1',
        decidedByType: 'user',
        decidedAt: 'date',
        snapshotHash: 'hash',
      },
      clientApproval: {
        status: 'approved',
        decidedBy: 'client-1',
        decidedByType: 'user',
        decidedAt: 'date',
        snapshotHash: 'hash',
      },
      publishLock: { locked: false, reasons: [] },
    },
    immutableAuditRecordIds: ['audit-1'],
    isLatestVersion: true,
    deleted: false,
    ...overrides,
  }
}

function releasePlan(overrides: Partial<YouTubeReleasePlan> = {}): YouTubeReleasePlan {
  return {
    id: 'release-1',
    orgId: 'org-1',
    channelWorkspaceId: 'channel-1',
    videoProjectId: 'video-1',
    publishingPacketId: 'packet-1',
    mode: 'private_api_upload',
    status: 'ready',
    uploadPrivacyStatus: 'private',
    targetVisibility: 'private',
    checks: {
      approvedPacket: pass,
      connectedAccount: pass,
      privateFirst: pass,
      clientConfirmation: { status: 'not_applicable', message: 'not needed' },
      scheduleWindow: { status: 'not_applicable', message: 'not scheduled' },
    },
    deleted: false,
    ...overrides,
  }
}

const videoAsset: YouTubeSourceAsset = {
  id: 'asset-1',
  orgId: 'org-1',
  channelWorkspaceId: 'channel-1',
  videoProjectId: 'video-1',
  title: 'Rendered video',
  assetType: 'rendered_video',
  status: 'ready',
  mediaFormat: 'horizontal',
  sourceUrl: 'https://cdn.example.com/video.mp4',
  rights: { status: 'cleared' },
  deleted: false,
}

describe('youtube studio production publishing integration guards', () => {
  it('passes only when approval, connected account, video asset, quota, and all readiness checks pass', () => {
    const result = evaluateYouTubePublishReadiness({
      channel: channel(),
      packet: packet(),
      releasePlan: releasePlan(),
      videoAsset,
    })

    expect(result.ready).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.mode).toBe('private_api_upload')
  })

  it('hard-blocks missing approvals and packet gate failures before upload can proceed', () => {
    const result = evaluateYouTubePublishReadiness({
      channel: channel(),
      packet: packet({
        approvedBy: undefined,
        approvedAt: undefined,
        approvedSnapshotHash: undefined,
        approvalState: undefined,
        immutableAuditRecordIds: [],
        checks: { ...packet().checks, rights: { status: 'block', message: 'Rights missing' } },
      }),
      releasePlan: releasePlan(),
      videoAsset,
    })

    expect(result.ready).toBe(false)
    expect(result.blockers).toEqual(expect.arrayContaining([
      'Publishing packet approval evidence is required before YouTube upload.',
      'Publishing packet check rights is blocking: Rights missing',
    ]))
  })

  it('hard-blocks new approval schema packets without client and internal approval identity', () => {
    const result = evaluateYouTubePublishReadiness({
      channel: channel(),
      packet: packet({
        approvedBy: undefined,
        approvedAt: undefined,
        approvedSnapshotHash: undefined,
        approvalState: {
          internalStatus: 'pending',
          clientStatus: 'changes_requested',
          changeRequestStatus: 'open',
          publishLock: { locked: true, reasons: ['Client requested title changes.'] },
        },
        immutableAuditRecordIds: [],
      }),
      releasePlan: releasePlan(),
      videoAsset,
    })

    expect(result.ready).toBe(false)
    expect(result.blockers).toEqual(expect.arrayContaining([
      'Internal publishing approval with approver identity is required before YouTube upload.',
      'Client publishing approval with approver identity is required before YouTube upload.',
      'Open publishing packet change requests must be resolved before YouTube upload.',
      'Publishing packet publish lock is active: Client requested title changes.',
      'Immutable publishing packet audit record is required before YouTube upload.',
    ]))
  })

  it('blocks superseded packet versions even when legacy approval fields are present', () => {
    const result = evaluateYouTubePublishReadiness({
      channel: channel(),
      packet: packet({ isLatestVersion: false, supersededByPacketId: 'packet-2' }),
      releasePlan: releasePlan(),
      videoAsset,
    })

    expect(result.ready).toBe(false)
    expect(result.blockers).toContain('Publishing packet is not the latest version for this video project.')
  })

  it('blocks quota-limited channels before attempting the YouTube Data API upload', () => {
    const result = evaluateYouTubePublishReadiness({
      channel: channel({
        publishingReadiness: {
          ...channel().publishingReadiness!,
          apiProjectStatus: 'quota_limited',
          quotaUnitsRemaining: YOUTUBE_UPLOAD_QUOTA_UNITS - 1,
        },
      }),
      packet: packet(),
      releasePlan: releasePlan(),
      videoAsset,
    })

    expect(result.ready).toBe(false)
    expect(result.quotaLimited).toBe(true)
    expect(result.blockers).toEqual(expect.arrayContaining([
      `YouTube upload requires at least ${YOUTUBE_UPLOAD_QUOTA_UNITS} quota units.`,
      'YouTube API project is quota limited.',
    ]))
  })

  it('keeps manual handoff release plans out of API upload execution', () => {
    const result = evaluateYouTubePublishReadiness({
      channel: channel(),
      packet: packet(),
      releasePlan: releasePlan({ mode: 'manual_handoff', status: 'ready' }),
      videoAsset,
    })

    expect(result.ready).toBe(false)
    expect(result.manualHandoffRequired).toBe(true)
    expect(result.blockers).toContain('Release plan is manual handoff; YouTube API upload is not allowed for this plan.')
  })

  it('classifies YouTube quota failures as non-retryable quota events for audit logs', () => {
    expect(classifyYouTubePublishError(new Error('YouTube upload error 403: quotaExceeded'))).toMatchObject({
      type: 'quota',
      retryable: false,
      status: 'quota_limited',
    })
  })

  it('builds private-first YouTube Data API upload options and preserves external video metadata', () => {
    const options = buildYouTubeUploadOptions({ packet: packet(), releasePlan: releasePlan({ targetVisibility: 'public' }), videoAsset })

    expect(options).toMatchObject({
      title: 'Approved title',
      text: 'Approved description',
      mediaUrls: ['https://cdn.example.com/video.mp4'],
      privacyStatus: 'private',
      targetVisibility: 'public',
      selfDeclaredMadeForKids: false,
      tags: ['growth', 'ops'],
    })
  })
})
