import { buildYouTubeAnalyticsSnapshotFromApiReports } from '@/lib/youtube-studio/analytics-ingestion'

describe('youtube analytics ingestion', () => {
  it('normalizes YouTube Analytics API reports into snapshot metrics and actioned recommendations', () => {
    const snapshot = buildYouTubeAnalyticsSnapshotFromApiReports({
      request: {
        orgId: 'org-1',
        channelWorkspaceId: 'channel-1',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-07',
      },
      videos: [
        { id: 'video-1', orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Short win', videoType: 'short', status: 'live', objective: 'Reach', source: { intakeType: 'manual' }, linked: {}, approvalPolicy: { requireInternalBriefApproval: false, requireClientBriefApproval: false, requireClientScriptApproval: false, requireClientDraftApproval: false, requireClientThumbnailApproval: false, requireClientPublishConfirmation: false, requireInternalPublishApproval: false }, youtubeVideoId: 'yt-short', deleted: false },
        { id: 'video-2', orgId: 'org-1', channelWorkspaceId: 'channel-1', title: 'Long proof', videoType: 'long_form', status: 'live', objective: 'Trust', source: { intakeType: 'manual' }, linked: {}, approvalPolicy: { requireInternalBriefApproval: false, requireClientBriefApproval: false, requireClientScriptApproval: false, requireClientDraftApproval: false, requireClientThumbnailApproval: false, requireClientPublishConfirmation: false, requireInternalPublishApproval: false }, youtubeVideoId: 'yt-long', seriesId: 'series-1', deleted: false },
      ],
      summaryReport: {
        columnHeaders: [
          { name: 'video' },
          { name: 'views' },
          { name: 'estimatedMinutesWatched' },
          { name: 'averageViewPercentage' },
          { name: 'impressionClickThroughRate' },
        ],
        rows: [
          ['yt-short', 300, 120, 54, 2.2],
          ['yt-long', 100, 250, 28, 4.1],
        ],
      },
      trafficSourceReport: {
        columnHeaders: [{ name: 'insightTrafficSourceType' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }],
        rows: [['YT_SEARCH', 180, 90]],
      },
      audienceReport: {
        columnHeaders: [{ name: 'ageGroup' }, { name: 'gender' }, { name: 'viewerPercentage' }],
        rows: [['age25-34', 'female', 64.5]],
      },
      retentionReport: {
        columnHeaders: [{ name: 'elapsedVideoTimeRatio' }, { name: 'audienceWatchRatio' }],
        rows: [[0.25, 31], [0.5, 22]],
      },
    })

    expect(snapshot.source).toBe('youtube_analytics_api')
    expect(snapshot.metrics).toMatchObject({
      views: 400,
      watchTimeMinutes: 370,
      retentionPercentage: 25,
      trafficSources: [{ source: 'YT_SEARCH', views: 180, watchTimeMinutes: 90 }],
      audience: [{ segment: 'age25-34 / female', viewerPercentage: 64.5 }],
      shortsVsLongForm: expect.arrayContaining([
        expect.objectContaining({ videoType: 'short', views: 300 }),
        expect.objectContaining({ videoType: 'long_form', views: 100 }),
      ]),
      seriesTrends: [expect.objectContaining({ seriesId: 'series-1', views: 100 })],
      videoComparisons: expect.arrayContaining([
        expect.objectContaining({ videoProjectId: 'video-1', youtubeVideoId: 'yt-short', title: 'Short win' }),
        expect.objectContaining({ videoProjectId: 'video-2', youtubeVideoId: 'yt-long', title: 'Long proof' }),
      ]),
    })
    expect(snapshot.recommendations.map((recommendation) => recommendation.actionType)).toEqual(expect.arrayContaining(['task', 'script_change', 'clip_idea']))
    expect(JSON.stringify(snapshot)).not.toContain('accessToken')
    expect(JSON.stringify(snapshot)).not.toContain('refreshToken')
  })
})
