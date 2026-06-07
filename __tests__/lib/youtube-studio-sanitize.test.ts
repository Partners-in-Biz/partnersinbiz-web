import {
  clientSafeYouTubePublishingPacket,
  clientSafeYouTubeChannelWorkspace,
  clientSafeYouTubeVideoProject,
  defaultYouTubeApprovalPolicy,
  defaultYouTubePublishingPolicy,
  sanitizeYouTubeChannelWorkspaceInput,
  sanitizeYouTubePublishingPolicyInput,
  sanitizeYouTubeSeriesInput,
  sanitizeYouTubeVideoProjectInput,
  serializeYouTubeRecord,
} from '@/lib/youtube-studio/sanitize'

function findUndefinedPaths(value: unknown, path = 'payload'): string[] {
  if (value === undefined) return [path]
  if (Array.isArray(value)) return value.flatMap((item, index) => findUndefinedPaths(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return []

  return Object.entries(value).flatMap(([key, entry]) => findUndefinedPaths(entry, `${path}.${key}`))
}

function expectNoUndefinedValues(value: unknown) {
  expect(findUndefinedPaths(value)).toEqual([])
}

describe('youtube studio sanitizers', () => {
  it('defaults channel policy fields and trims strategy inputs', () => {
    const result = sanitizeYouTubeChannelWorkspaceInput({
      orgId: ' org-1 ',
      title: '  Acme Channel  ',
      status: 'unknown',
      contentPillars: [' Growth ', '', 'Retention'],
      avoidTopics: 'politics\nunsupported claims',
      audienceNotes: '  Owners  ',
    })

    expect(result).toMatchObject({
      orgId: 'org-1',
      title: 'Acme Channel',
      status: 'setup',
      contentPillars: ['Growth', 'Retention'],
      avoidTopics: ['politics', 'unsupported claims'],
      audienceNotes: 'Owners',
      defaultApprovalPolicy: defaultYouTubeApprovalPolicy(),
      defaultPublishingPolicy: defaultYouTubePublishingPolicy(),
      deleted: false,
    })
  })

  it('preserves valid publishing policy overrides and falls back safely', () => {
    expect(
      sanitizeYouTubePublishingPolicyInput({
        allowedModes: ['private_api_upload', 'scheduled_api_publish', 'bad-mode'],
        defaultVisibility: 'unlisted',
        privateFirstRequired: false,
        publicPublishRequiresAdmin: false,
        publicPublishRequiresClientConfirmation: true,
      })
    ).toEqual({
      allowedModes: ['private_api_upload', 'scheduled_api_publish'],
      defaultVisibility: 'unlisted',
      privateFirstRequired: false,
      publicPublishRequiresAdmin: false,
      publicPublishRequiresClientConfirmation: true,
    })

    expect(
      sanitizeYouTubePublishingPolicyInput({
        allowedModes: ['bad-mode'],
        defaultVisibility: 'bad-visibility',
        privateFirstRequired: 'no',
      })
    ).toEqual(defaultYouTubePublishingPolicy())
  })

  it('removes undefined values from minimal Firestore write payloads', () => {
    expectNoUndefinedValues(sanitizeYouTubeChannelWorkspaceInput({ orgId: 'org-1', title: 'Channel' }))
    expectNoUndefinedValues(
      sanitizeYouTubeSeriesInput({
        orgId: 'org-1',
        channelWorkspaceId: 'channel-1',
        name: 'Series',
        episodeTemplate: {
          sections: [{ label: 'Intro', targetSeconds: undefined }],
        },
      })
    )
    expectNoUndefinedValues(
      sanitizeYouTubeVideoProjectInput({
        orgId: 'org-1',
        channelWorkspaceId: 'channel-1',
        title: 'Video',
        objective: 'Explain the service',
        source: { sourceUrl: undefined },
        linked: { taskIds: [' task-1 ', undefined, ''] },
      })
    )
  })

  it('sanitizes series format and cadence to safe defaults', () => {
    const result = sanitizeYouTubeSeriesInput({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      name: 'Weekly Wins',
      format: 'bad-format',
      cadence: 'weekly',
      status: 'bad-status',
      episodeTemplate: {
        hook: 'Lead with the client result',
        sections: [{ label: 'Problem', targetSeconds: 30 }, { label: '' }],
      },
    })

    expect(result).toMatchObject({
      format: 'mixed',
      cadence: 'weekly',
      status: 'active',
      episodeTemplate: {
        hook: 'Lead with the client result',
        sections: [{ label: 'Problem', targetSeconds: 30 }],
      },
      deleted: false,
    })
  })

  it('keeps portal video records client safe', () => {
    const video = sanitizeYouTubeVideoProjectInput({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      title: 'Draft',
      objective: 'Explain the service',
      videoType: 'long_form',
      internalNotes: 'Do not show this risk note',
      source: {
        intakeType: 'source_url',
        researchItemId: 'research-secret',
        campaignId: 'campaign-secret',
        projectId: 'project-secret',
        sourceUrl: 'https://internal.example/source',
        transcriptAssetId: 'transcript-secret',
      },
      linked: {
        projectId: 'project-secret',
        taskIds: ['task-secret'],
        documentIds: ['doc-secret'],
        campaignId: 'campaign-secret',
        socialPostIds: ['social-secret'],
      },
      approvalPolicy: { requireInternalPublishApproval: true },
      publishPacketId: 'packet-secret',
      youtubeVideoId: 'youtube-secret',
      scheduledAt: { seconds: 1 },
      publishedAt: { seconds: 2 },
      clientReview: { status: 'requested', notes: 'Client-facing note', decidedBy: 'client-secret' },
      visibility: { showInClientPortal: true },
    })

    const safe = clientSafeYouTubeVideoProject({
      id: 'video-1',
      ...video,
      createdBy: 'admin-1',
      updatedBy: 'admin-2',
    })
    expect(safe).not.toHaveProperty('internalNotes')
    expect(safe).not.toHaveProperty('createdBy')
    expect(safe).not.toHaveProperty('updatedBy')
    expect(safe).not.toHaveProperty('approvalPolicy')
    expect(safe).not.toHaveProperty('linked')
    expect(safe).not.toHaveProperty('publishPacketId')
    expect(safe).not.toHaveProperty('youtubeVideoId')
    expect(safe).not.toHaveProperty('scheduledAt')
    expect(safe).not.toHaveProperty('publishedAt')
    expect(safe.source).toEqual({ intakeType: 'source_url' })
    expect(safe.clientReview).not.toHaveProperty('decidedBy')
    expect(safe).toMatchObject({
      id: 'video-1',
      title: 'Draft',
      videoType: 'long_form',
    })
  })

  it('serializes Firestore records through JSON-safe values', () => {
    const serialized = serializeYouTubeRecord('id-1', {
      orgId: 'org-1',
      title: 'Acme',
      createdAt: { seconds: 1 },
    })

    expect(serialized).toMatchObject({ id: 'id-1', orgId: 'org-1', title: 'Acme' })
  })

  it('hides internal channel access fields from portal clients', () => {
    const channel = sanitizeYouTubeChannelWorkspaceInput({
      orgId: 'org-1',
      title: 'Client Channel',
      connectedAccountId: 'secret-oauth-id',
      strategyDocumentId: 'strategy-secret',
      internalNotes: 'internal',
    })

    const safe = clientSafeYouTubeChannelWorkspace({
      id: 'channel-1',
      ...channel,
      createdBy: 'admin-1',
      updatedBy: 'admin-2',
    })
    expect(safe).not.toHaveProperty('connectedAccountId')
    expect(safe).not.toHaveProperty('internalNotes')
    expect(safe).not.toHaveProperty('createdBy')
    expect(safe).not.toHaveProperty('updatedBy')
    expect(safe).not.toHaveProperty('strategyDocumentId')
    expect(safe).not.toHaveProperty('defaultApprovalPolicy')
    expect(safe).not.toHaveProperty('defaultPublishingPolicy')
  })

  it('redacts internal publishing packet audit fields for portal clients', () => {
    const safe = clientSafeYouTubePublishingPacket({
      id: 'packet-1',
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      videoProjectId: 'video-1',
      versionNumber: 1,
      supersedesPacketId: 'packet-parent-secret',
      status: 'approved',
      titleOptions: [{ text: 'Launch plan', selected: true }],
      tags: ['growth'],
      chapters: [{ startSeconds: 0, title: 'Intro' }],
      thumbnailAssetId: 'thumbnail-secret',
      captionAssetId: 'caption-secret',
      videoAssetId: 'video-secret',
      visibility: 'private',
      checks: {
        rights: {
          status: 'pass',
          message: 'Rights cleared',
          checkedBy: 'admin-1',
          checkedByType: 'user',
          checkedAt: { seconds: 1 },
        },
        aiDisclosure: { status: 'warning', message: 'Review disclosure', checkedBy: 'agent-1' },
        madeForKids: { status: 'pass', message: 'Not made for kids' },
        metadata: { status: 'pass', message: 'Metadata complete' },
        thumbnail: { status: 'pass', message: 'Thumbnail approved' },
        captions: { status: 'pass', message: 'Captions ready' },
        approval: { status: 'pass', message: 'Approved', checkedByType: 'system' },
        connectedAccount: {
          status: 'warning',
          message: 'Manual handoff required',
          checkedBy: 'admin-2',
          checkedByType: 'user',
        },
      },
      approvedBy: 'admin-1',
      approvedAt: { seconds: 2 },
      approvedSnapshotHash: 'secret-hash',
      deleted: false,
    })

    expect(safe).toMatchObject({
      checks: {
        rights: { status: 'pass', message: 'Rights cleared' },
        aiDisclosure: { status: 'warning', message: 'Review disclosure' },
      },
    })
    expect(safe).not.toHaveProperty('approvedBy')
    expect(safe).not.toHaveProperty('approvedAt')
    expect(safe).not.toHaveProperty('approvedSnapshotHash')
    expect(safe).not.toHaveProperty('supersedesPacketId')
    expect(safe).not.toHaveProperty('thumbnailAssetId')
    expect(safe).not.toHaveProperty('captionAssetId')
    expect(safe).not.toHaveProperty('videoAssetId')
    expect(safe.checks).not.toHaveProperty('connectedAccount')
    expect(safe.checks.rights).not.toHaveProperty('checkedBy')
    expect(safe.checks.rights).not.toHaveProperty('checkedByType')
    expect(safe.checks.rights).not.toHaveProperty('checkedAt')
    expect(safe.checks.aiDisclosure).not.toHaveProperty('checkedBy')
    expect(safe.checks.approval).not.toHaveProperty('checkedByType')
  })
})
