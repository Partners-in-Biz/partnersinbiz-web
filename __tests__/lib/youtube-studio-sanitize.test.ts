import {
  clientSafeYouTubeAnalyticsSnapshot,
  clientSafeYouTubePublishingPacket,
  clientSafeYouTubeChannelWorkspace,
  clientSafeYouTubeSeries,
  clientSafeYouTubeVideoProject,
  defaultYouTubeApprovalPolicy,
  defaultYouTubePublishingPolicy,
  sanitizeYouTubeAgentJobInput,
  sanitizeYouTubeAnalyticsSnapshotInput,
  sanitizeYouTubeChannelWorkspaceInput,
  sanitizeYouTubePublishingPolicyInput,
  sanitizeYouTubePublishingReadinessInput,
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

  it('sanitizes channel publishing readiness records', () => {
    const result = sanitizeYouTubePublishingReadinessInput({
      accountStatus: 'connected',
      apiProjectStatus: 'verified',
      readiness: 'scheduled_publish_ready',
      defaultUploadPrivacy: 'public',
      allowedModes: ['manual_handoff', 'private_api_upload', 'scheduled_api_publish', 'bad-mode'],
      quotaDailyLimit: 10000,
      quotaUnitsRemaining: -1,
      lastCheckedAt: '2026-06-08T06:00:00.000Z',
      checkedBy: ' admin-1 ',
      checkedByType: 'agent',
      notes: ' Ready after compliance review. ',
      deleted: true,
    })

    expect(result).toEqual({
      accountStatus: 'connected',
      apiProjectStatus: 'verified',
      readiness: 'scheduled_publish_ready',
      defaultUploadPrivacy: 'public',
      allowedModes: ['manual_handoff', 'private_api_upload', 'scheduled_api_publish'],
      quotaDailyLimit: 10000,
      lastCheckedAt: '2026-06-08T06:00:00.000Z',
      checkedBy: 'admin-1',
      checkedByType: 'agent',
      notes: 'Ready after compliance review.',
    })
    expectNoUndefinedValues(result)

    expect(sanitizeYouTubePublishingReadinessInput({ accountStatus: 'bad', allowedModes: ['bad-mode'] })).toEqual({
      accountStatus: 'not_connected',
      apiProjectStatus: 'unknown',
      readiness: 'not_ready',
      defaultUploadPrivacy: 'private',
      allowedModes: ['manual_handoff'],
    })
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

  it('sanitizes agent job payloads to known skills, statuses, and links', () => {
    const result = sanitizeYouTubeAgentJobInput({
      orgId: ' org-1 ',
      channelWorkspaceId: ' channel-1 ',
      seriesId: ' series-1 ',
      videoProjectId: ' video-1 ',
      skillKey: 'unknown-skill',
      title: ' Brief packet ',
      status: 'published',
      priority: 'urgent',
      visibility: 'public',
      inputSummary: ' Use the client request. ',
      outputArtifactIds: [' artifact-1 ', '', { bad: true }],
      linked: {
        taskIds: 'task-1, task-2',
        documentIds: [' doc-1 ', ''],
        researchItemIds: [{ bad: true }, ' research-1 '],
        sourceAssetIds: [' asset-1 '],
        clipCandidateIds: [' clip-1 '],
        productionDraftIds: [' draft-1 '],
        renderJobIds: [' render-1 '],
        publishingPacketIds: [' packet-1 '],
        analyticsSnapshotIds: [' snapshot-1 '],
      },
      inputPacket: {
        skillKey: 'youtube-autopublish',
        skillLabel: ' Client supplied ',
        family: 'publishing',
        inputSummary: ' Use the packet. ',
        requiredContext: [' packet '],
        outputArtifacts: [' readiness result '],
        guardrails: [' no autopublish '],
        policySourceKeys: [' youtube_data_api_upload_private_first '],
        references: {
          channelWorkspaceId: ' channel-1 ',
          seriesId: ' series-1 ',
          videoProjectId: ' video-1 ',
          sourceAssetIds: [' asset-1 '],
          clipCandidateIds: [' clip-1 '],
          productionDraftIds: [' draft-1 '],
          renderJobIds: [' render-1 '],
          publishingPacketIds: [' packet-1 '],
          analyticsSnapshotIds: [' snapshot-1 '],
        },
      },
      reviewRequired: false,
      deleted: true,
    })

    expect(result).toEqual({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      seriesId: 'series-1',
      videoProjectId: 'video-1',
      skillKey: 'youtube-video-brief',
      title: 'Brief packet',
      status: 'queued',
      priority: 'urgent',
      inputSummary: 'Use the client request.',
      outputArtifactIds: ['artifact-1'],
      reviewRequired: false,
      visibility: 'internal',
      linked: {
        taskIds: ['task-1', 'task-2'],
        documentIds: ['doc-1'],
        researchItemIds: ['research-1'],
        sourceAssetIds: ['asset-1'],
        clipCandidateIds: ['clip-1'],
        productionDraftIds: ['draft-1'],
        renderJobIds: ['render-1'],
        publishingPacketIds: ['packet-1'],
        analyticsSnapshotIds: ['snapshot-1'],
      },
      inputPacket: {
        skillKey: 'youtube-video-brief',
        skillLabel: 'Client supplied',
        family: 'production',
        inputSummary: 'Use the packet.',
        requiredContext: ['packet'],
        outputArtifacts: ['readiness result'],
        guardrails: ['no autopublish'],
        policySourceKeys: ['youtube_data_api_upload_private_first'],
        references: {
          channelWorkspaceId: 'channel-1',
          seriesId: 'series-1',
          videoProjectId: 'video-1',
          sourceAssetIds: ['asset-1'],
          clipCandidateIds: ['clip-1'],
          productionDraftIds: ['draft-1'],
          renderJobIds: ['render-1'],
          publishingPacketIds: ['packet-1'],
          analyticsSnapshotIds: ['snapshot-1'],
        },
      },
      deleted: true,
    })
    expectNoUndefinedValues(result)
  })

  it('sanitizes analytics snapshots and client-safe analytics summaries', () => {
    const result = sanitizeYouTubeAnalyticsSnapshotInput({
      orgId: ' org-1 ',
      channelWorkspaceId: ' channel-1 ',
      videoProjectId: ' video-1 ',
      seriesId: ' series-1 ',
      youtubeVideoId: ' youtube-1 ',
      periodStart: ' 2026-06-01 ',
      periodEnd: ' 2026-06-07 ',
      source: 'bad-source',
      sourceFreshness: 'estimated',
      metrics: {
        views: 100,
        watchTimeMinutes: -1,
        averageViewDurationSeconds: 45,
        averageViewPercentage: 44,
        impressionsCtr: 3.2,
        comments: 'bad',
      },
      dimensions: {
        country: ' ZA ',
        hidden: { nested: true },
      },
      recommendations: [
        {
          type: 'thumbnail_test',
          summary: ' Test a clearer thumbnail. ',
          confidence: 'medium',
          status: 'accepted',
          taskId: ' task-1 ',
          notes: ' Internal note ',
        },
        {
          type: 'retitle',
          summary: '',
          confidence: 'high',
        },
      ],
      clientSummary: ' Useful client summary. ',
      internalNotes: ' Operator notes. ',
      visibility: { showInClientPortal: true },
      deleted: true,
    })

    expect(result).toEqual({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      videoProjectId: 'video-1',
      youtubeVideoId: 'youtube-1',
      seriesId: 'series-1',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-07',
      source: 'manual_import',
      sourceFreshness: 'estimated',
      metrics: {
        views: 100,
        averageViewDurationSeconds: 45,
        averageViewPercentage: 44,
        impressionsCtr: 3.2,
      },
      dimensions: { country: 'ZA' },
      recommendations: [{
        type: 'thumbnail_test',
        summary: 'Test a clearer thumbnail.',
        confidence: 'medium',
        status: 'accepted',
        taskId: 'task-1',
        notes: 'Internal note',
      }],
      clientSummary: 'Useful client summary.',
      internalNotes: 'Operator notes.',
      visibility: { showInClientPortal: true },
      deleted: true,
    })
    expectNoUndefinedValues(result)

    const safe = clientSafeYouTubeAnalyticsSnapshot({
      id: 'snapshot-1',
      ...result,
      source: 'youtube_analytics_api',
      sourceFreshness: 'delayed',
      importedBy: 'admin-1',
      importedAt: { seconds: 1 },
      createdBy: 'admin-1',
      updatedBy: 'admin-2',
    })

    expect(safe).toEqual({
      id: 'snapshot-1',
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      videoProjectId: 'video-1',
      seriesId: 'series-1',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-07',
      source: 'youtube_analytics_api',
      sourceFreshness: 'delayed',
      metrics: {
        views: 100,
        averageViewDurationSeconds: 45,
        averageViewPercentage: 44,
        impressionsCtr: 3.2,
      },
      clientSummary: 'Useful client summary.',
      recommendations: [{
        type: 'thumbnail_test',
        summary: 'Test a clearer thumbnail.',
        confidence: 'medium',
        status: 'accepted',
      }],
    })
    expect(safe).not.toHaveProperty('dimensions')
    expect(safe).not.toHaveProperty('internalNotes')
    expect(JSON.stringify(safe)).not.toContain('task-1')
    expect(JSON.stringify(safe)).not.toContain('Internal note')
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

  it('keeps portal series records client safe', () => {
    const safe = clientSafeYouTubeSeries({
      id: 'series-1',
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      name: 'Client Series',
      objective: 'Build trust',
      audience: 'Owners',
      format: 'long_form',
      cadence: 'weekly',
      targetDurationSeconds: 600,
      episodeTemplate: {
        hook: 'Open with the result',
        sections: [
          {
            label: 'Problem',
            targetSeconds: 90,
            notes: 'Client-facing structure',
            internalPrompt: 'hidden',
          } as { label: string; targetSeconds?: number; notes?: string },
        ],
        outro: 'Close with action',
        internalTemplateId: 'template-secret',
      } as {
        hook?: string
        sections: Array<{ label: string; targetSeconds?: number; notes?: string }>
        outro?: string
      },
      styleGuide: {
        visualNotes: 'Bright office footage',
        thumbnailNotes: 'Founder portrait',
        captionNotes: 'Sentence case',
        introOutroRules: 'Keep the intro short',
        internalStyleToken: 'style-secret',
      } as {
        visualNotes?: string
        thumbnailNotes?: string
        captionNotes?: string
        introOutroRules?: string
      },
      season: 'Season 1',
      status: 'active',
      deleted: false,
      createdBy: 'admin-1',
      updatedBy: 'admin-2',
    } as Parameters<typeof clientSafeYouTubeSeries>[0])

    expect(Object.keys(safe).sort()).toEqual([
      'audience',
      'cadence',
      'channelWorkspaceId',
      'episodeTemplate',
      'format',
      'id',
      'name',
      'objective',
      'orgId',
      'season',
      'status',
      'styleGuide',
      'targetDurationSeconds',
    ].sort())
    expect(safe.episodeTemplate.sections).toEqual([
      { label: 'Problem', targetSeconds: 90, notes: 'Client-facing structure' },
    ])
    expect(safe).not.toHaveProperty('createdBy')
    expect(safe).not.toHaveProperty('updatedBy')
    expect(safe).not.toHaveProperty('deleted')
    expect(safe.episodeTemplate).not.toHaveProperty('internalTemplateId')
    expect(safe.episodeTemplate.sections[0]).not.toHaveProperty('internalPrompt')
    expect(safe.styleGuide).not.toHaveProperty('internalStyleToken')
  })

  it('drops malformed portal series sections and object-valued series scalars', () => {
    const safe = clientSafeYouTubeSeries({
      id: 'series-1',
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      name: 'Client Series',
      objective: { internalNote: 'secret objective' } as unknown as string,
      audience: '  Owners  ',
      format: 'long_form',
      cadence: 'weekly',
      targetDurationSeconds: { seconds: 600 } as unknown as number,
      episodeTemplate: {
        hook: { internalPrompt: 'secret hook' } as unknown as string,
        sections: [
          null,
          'not-a-section',
          {
            label: { text: 'Internal section', policyNotes: 'operator-only section policy' },
            targetSeconds: 30,
            notes: 'should drop with malformed label',
          },
          {
            label: ' Safe segment ',
            targetSeconds: Number.POSITIVE_INFINITY,
            notes: { internalPrompt: 'secret section notes' },
          },
          {
            label: 'Negative segment',
            targetSeconds: -5,
            notes: 'Keep section but omit negative duration',
          },
          {
            label: 'Valid segment',
            targetSeconds: 45,
            notes: '  Client notes  ',
            internalPrompt: 'hidden',
          },
        ],
        outro: { internalPrompt: 'secret outro' } as unknown as string,
      } as unknown as {
        hook?: string
        sections: Array<{ label: string; targetSeconds?: number; notes?: string }>
        outro?: string
      },
      styleGuide: {
        visualNotes: { internalPrompt: 'secret visual note' } as unknown as string,
        thumbnailNotes: '  Thumbnail guidance  ',
        captionNotes: { policyNotes: 'secret caption policy' } as unknown as string,
        introOutroRules: '  Keep it concise  ',
      },
      season: { internalSeasonPlan: 'secret season' } as unknown as string,
      status: 'active',
      deleted: false,
    } as Parameters<typeof clientSafeYouTubeSeries>[0])

    expect(safe).not.toHaveProperty('objective')
    expect(safe.audience).toBe('Owners')
    expect(safe).not.toHaveProperty('targetDurationSeconds')
    expect(safe).not.toHaveProperty('season')
    expect(safe.episodeTemplate).toEqual({
      sections: [
        { label: 'Safe segment' },
        { label: 'Negative segment', notes: 'Keep section but omit negative duration' },
        { label: 'Valid segment', targetSeconds: 45, notes: 'Client notes' },
      ],
    })
    expect(safe.styleGuide).toEqual({
      thumbnailNotes: 'Thumbnail guidance',
      introOutroRules: 'Keep it concise',
    })
    expect(JSON.stringify(safe)).not.toContain('internalPrompt')
    expect(JSON.stringify(safe)).not.toContain('policyNotes')
    expect(JSON.stringify(safe)).not.toContain('secret')
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

  it('drops malformed portal video scalars and nested review/source values', () => {
    const safe = clientSafeYouTubeVideoProject({
      id: { raw: 'video-secret-id' } as unknown as string,
      orgId: ' org-1 ',
      channelWorkspaceId: ' channel-1 ',
      seriesId: { raw: 'series-secret-id' } as unknown as string,
      title: { text: 'Operator-only title', policyNotes: 'secret video title policy' } as unknown as string,
      workingTitle: ' Client draft ',
      videoType: 'bad-video-type' as Parameters<typeof clientSafeYouTubeVideoProject>[0]['videoType'],
      status: { raw: 'client_review' } as unknown as Parameters<typeof clientSafeYouTubeVideoProject>[0]['status'],
      objective: { internalPrompt: 'secret objective' } as unknown as string,
      targetAudience: { internalPrompt: 'secret audience' } as unknown as string,
      targetDurationSeconds: Number.POSITIVE_INFINITY,
      source: {
        intakeType: { raw: 'research' } as unknown as Parameters<typeof clientSafeYouTubeVideoProject>[0]['source']['intakeType'],
        researchItemId: 'research-secret',
      },
      linked: {},
      approvalPolicy: defaultYouTubeApprovalPolicy(),
      clientReview: {
        status: { raw: 'requested' } as unknown as NonNullable<Parameters<typeof clientSafeYouTubeVideoProject>[0]['clientReview']>['status'],
        notes: { internalPrompt: 'secret review note' } as unknown as string,
        decidedBy: 'client-secret',
      },
      clientNotes: ' Client-facing note ',
      visibility: {
        showInClientPortal: { raw: true } as unknown as boolean,
        showAnalytics: true,
        showPublishingPacket: { raw: true } as unknown as boolean,
      },
      deleted: false,
    } as Parameters<typeof clientSafeYouTubeVideoProject>[0])

    expect(safe).toMatchObject({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      title: 'Untitled video',
      workingTitle: 'Client draft',
      videoType: 'long_form',
      status: 'intake',
      objective: '',
      source: { intakeType: 'manual' },
      clientReview: { status: 'not_requested' },
      clientNotes: 'Client-facing note',
      visibility: { showAnalytics: true },
    })
    expect(safe).not.toHaveProperty('id')
    expect(safe).not.toHaveProperty('seriesId')
    expect(safe).not.toHaveProperty('targetAudience')
    expect(safe).not.toHaveProperty('targetDurationSeconds')
    expect(safe.visibility).not.toHaveProperty('showInClientPortal')
    expect(safe.visibility).not.toHaveProperty('showPublishingPacket')
    expect(JSON.stringify(safe)).not.toContain('secret')
    expect(JSON.stringify(safe)).not.toContain('Operator-only')
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

  it('narrows portal channel content pillars to strings only', () => {
    const safe = clientSafeYouTubeChannelWorkspace({
      id: 'channel-1',
      orgId: 'org-1',
      title: 'Client Channel',
      status: 'active',
      defaultApprovalPolicy: defaultYouTubeApprovalPolicy(),
      defaultPublishingPolicy: defaultYouTubePublishingPolicy(),
      contentPillars: [
        ' Growth ',
        { label: 'Retention', policyNotes: 'internal pillar guidance' },
        '',
        'Case studies',
      ] as unknown as string[],
      avoidTopics: [],
      aiDisclosureDefaults: { syntheticMediaLikely: false },
      deleted: false,
    })

    expect(safe.contentPillars).toEqual(['Growth', 'Case studies'])
    expect(JSON.stringify(safe)).not.toContain('policyNotes')
  })

  it('drops malformed portal channel scalars and visibility values', () => {
    const safe = clientSafeYouTubeChannelWorkspace({
      id: { raw: 'channel-secret-id' } as unknown as string,
      orgId: ' org-1 ',
      title: { text: 'Operator-only channel', policyNotes: 'secret channel policy' } as unknown as string,
      youtubeChannelId: { raw: 'youtube-secret' } as unknown as string,
      youtubeHandle: ' @client ',
      status: { raw: 'active' } as unknown as Parameters<typeof clientSafeYouTubeChannelWorkspace>[0]['status'],
      defaultApprovalPolicy: defaultYouTubeApprovalPolicy(),
      defaultPublishingPolicy: defaultYouTubePublishingPolicy(),
      contentPillars: [' Growth ', { internalPrompt: 'secret pillar' }, 'Retention'] as unknown as string[],
      audienceNotes: { internalPrompt: 'secret audience note' } as unknown as string,
      avoidTopics: [],
      aiDisclosureDefaults: {
        syntheticMediaLikely: { raw: true } as unknown as boolean,
        notes: { internalPrompt: 'secret disclosure note' } as unknown as string,
      },
      clientNotes: ' Client-facing note ',
      visibility: {
        showInClientPortal: { raw: true } as unknown as boolean,
        showAnalytics: false,
      },
      deleted: false,
    })

    expect(safe).toMatchObject({
      orgId: 'org-1',
      title: 'Untitled YouTube channel',
      youtubeHandle: '@client',
      status: 'setup',
      contentPillars: ['Growth', 'Retention'],
      clientNotes: 'Client-facing note',
      aiDisclosureDefaults: { syntheticMediaLikely: false },
      visibility: { showAnalytics: false },
    })
    expect(safe).not.toHaveProperty('id')
    expect(safe).not.toHaveProperty('youtubeChannelId')
    expect(safe).not.toHaveProperty('audienceNotes')
    expect(safe.visibility).not.toHaveProperty('showInClientPortal')
    expect(JSON.stringify(safe)).not.toContain('secret')
    expect(JSON.stringify(safe)).not.toContain('Operator-only')
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
      titleOptions: [
        {
          text: 'Launch plan',
          rationale: 'Client-safe framing',
          selected: true,
          internalPrompt: 'secret title prompt',
          scoringAudit: { score: 0.92 },
          sourceAssetId: 'title-source-secret',
          policyNotes: 'operator-only title policy note',
        },
        {
          text: '',
          selected: true,
          internalPrompt: 'empty title should not leak',
        },
      ] as Array<{ text: string; rationale?: string; selected?: boolean }>,
      tags: [
        'growth',
        { text: 'internal', internalPrompt: 'secret tag prompt' },
        '',
        'retention',
      ] as unknown as string[],
      chapters: [
        {
          startSeconds: 0,
          title: 'Intro',
          internalPrompt: 'secret chapter prompt',
          scoringAudit: { score: 0.88 },
          sourceAssetId: 'chapter-source-secret',
          policyNotes: 'operator-only chapter policy note',
        },
        {
          startSeconds: 45,
          title: '',
          internalPrompt: 'empty chapter should not leak',
        },
        {
          startSeconds: -1,
          title: 'Legacy negative start',
          internalPrompt: 'negative chapter should not leak',
        },
      ] as Array<{ startSeconds: number; title: string }>,
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
    expect(safe.titleOptions).toEqual([
      { text: 'Launch plan', rationale: 'Client-safe framing', selected: true },
    ])
    expect(safe.tags).toEqual(['growth', 'retention'])
    expect(JSON.stringify(safe)).not.toContain('internalPrompt')
    expect(safe.chapters).toEqual([{ startSeconds: 0, title: 'Intro' }])
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
    expect(safe.titleOptions[0]).not.toHaveProperty('internalPrompt')
    expect(safe.titleOptions[0]).not.toHaveProperty('scoringAudit')
    expect(safe.titleOptions[0]).not.toHaveProperty('sourceAssetId')
    expect(safe.titleOptions[0]).not.toHaveProperty('policyNotes')
    expect(safe.chapters[0]).not.toHaveProperty('internalPrompt')
    expect(safe.chapters[0]).not.toHaveProperty('scoringAudit')
    expect(safe.chapters[0]).not.toHaveProperty('sourceAssetId')
    expect(safe.chapters[0]).not.toHaveProperty('policyNotes')
  })

  it('drops malformed portal packet scalars and gate check messages', () => {
    const safe = clientSafeYouTubePublishingPacket({
      id: { raw: 'packet-secret-id' } as unknown as string,
      orgId: ' org-1 ',
      channelWorkspaceId: ' channel-1 ',
      videoProjectId: ' video-1 ',
      versionNumber: { raw: 2 } as unknown as number,
      status: { raw: 'approved' } as unknown as Parameters<typeof clientSafeYouTubePublishingPacket>[0]['status'],
      titleOptions: [
        {
          text: ' Client title ',
          rationale: { internalPrompt: 'secret rationale' } as unknown as string,
          selected: { raw: true } as unknown as boolean,
        },
      ],
      description: { internalPrompt: 'secret description' } as unknown as string,
      tags: [' growth ', { internalPrompt: 'secret tag' }] as unknown as string[],
      chapters: [{ startSeconds: 0, title: ' Intro ', internalPrompt: 'secret chapter' } as { startSeconds: number; title: string }],
      visibility: { raw: 'public' } as unknown as Parameters<typeof clientSafeYouTubePublishingPacket>[0]['visibility'],
      selfDeclaredMadeForKids: { raw: false } as unknown as boolean,
      containsSyntheticMedia: true,
      aiDisclosureNotes: { internalPrompt: 'secret disclosure note' } as unknown as string,
      checks: {
        rights: {
          status: { raw: 'pass' } as unknown as Parameters<typeof clientSafeYouTubePublishingPacket>[0]['checks']['rights']['status'],
          message: { internalPrompt: 'secret rights message' } as unknown as string,
          checkedBy: 'admin-secret',
        },
        aiDisclosure: {
          status: 'warning',
          message: ' Review disclosure ',
          checkedBy: 'agent-secret',
        },
        madeForKids: 'secret malformed check' as unknown as Parameters<typeof clientSafeYouTubePublishingPacket>[0]['checks']['madeForKids'],
        metadata: { status: 'pass', message: ' Metadata complete ' },
        thumbnail: { status: 'pass', message: ' Thumbnail approved ' },
        captions: { status: 'pass', message: ' Captions ready ' },
        approval: { status: 'pass', message: ' Approved ', checkedByType: 'system' },
        connectedAccount: {
          status: 'warning',
          message: 'secret connected account',
        },
      },
      deleted: false,
    } as Parameters<typeof clientSafeYouTubePublishingPacket>[0])

    expect(safe).toMatchObject({
      orgId: 'org-1',
      channelWorkspaceId: 'channel-1',
      videoProjectId: 'video-1',
      versionNumber: 1,
      status: 'draft',
      titleOptions: [{ text: 'Client title' }],
      tags: ['growth'],
      chapters: [{ startSeconds: 0, title: 'Intro' }],
      visibility: 'private',
      containsSyntheticMedia: true,
      checks: {
        rights: { status: 'not_applicable' },
        aiDisclosure: { status: 'warning', message: 'Review disclosure' },
        madeForKids: { status: 'not_applicable' },
      },
    })
    expect(safe).not.toHaveProperty('id')
    expect(safe).not.toHaveProperty('description')
    expect(safe).not.toHaveProperty('selfDeclaredMadeForKids')
    expect(safe).not.toHaveProperty('aiDisclosureNotes')
    expect(safe.checks).not.toHaveProperty('connectedAccount')
    expect(safe.checks.rights).not.toHaveProperty('message')
    expect(safe.checks.aiDisclosure).not.toHaveProperty('checkedBy')
    expect(JSON.stringify(safe)).not.toContain('secret')
  })
})
