import {
  clientSafeYouTubeChannelWorkspace,
  clientSafeYouTubeVideoProject,
  defaultYouTubeApprovalPolicy,
  defaultYouTubePublishingPolicy,
  sanitizeYouTubeChannelWorkspaceInput,
  sanitizeYouTubeSeriesInput,
  sanitizeYouTubeVideoProjectInput,
  serializeYouTubeRecord,
} from '@/lib/youtube-studio/sanitize'

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
      visibility: { showInClientPortal: true },
    })

    expect(clientSafeYouTubeVideoProject({ id: 'video-1', ...video })).not.toHaveProperty('internalNotes')
    expect(clientSafeYouTubeVideoProject({ id: 'video-1', ...video })).toMatchObject({
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
      internalNotes: 'internal',
    })

    const safe = clientSafeYouTubeChannelWorkspace({ id: 'channel-1', ...channel })
    expect(safe).not.toHaveProperty('connectedAccountId')
    expect(safe).not.toHaveProperty('internalNotes')
  })
})
