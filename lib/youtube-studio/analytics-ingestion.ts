import { google } from 'googleapis'
import type { YouTubeAnalyticsMetrics, YouTubeAnalyticsRecommendation, YouTubeAnalyticsSnapshot, YouTubeVideoProject } from './types'

export interface YouTubeAnalyticsIngestionRequest {
  orgId: string
  channelWorkspaceId: string
  youtubeChannelId?: string
  videoProjectId?: string
  youtubeVideoId?: string
  seriesId?: string
  periodStart: string
  periodEnd: string
  accessToken?: string
  refreshToken?: string | null
  videos?: YouTubeVideoProject[]
}

interface YouTubeAnalyticsColumnHeader {
  name?: string | null
}

interface YouTubeAnalyticsReport {
  columnHeaders?: YouTubeAnalyticsColumnHeader[] | null
  rows?: unknown[][] | null
}

interface ParsedReportRow {
  [key: string]: string | number | undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseReportRows(report: YouTubeAnalyticsReport): ParsedReportRow[] {
  const headers = (report.columnHeaders ?? []).map((header) => header.name).filter((name): name is string => Boolean(name))
  const rows = Array.isArray(report.rows) ? report.rows : []
  return rows.map((row) => {
    const parsed: ParsedReportRow = {}
    headers.forEach((name, index) => {
      const value = row[index]
      parsed[name] = typeof value === 'number' ? value : stringValue(value)
    })
    return parsed
  })
}

function sum(rows: ParsedReportRow[], key: string): number | undefined {
  const total = rows.reduce((acc, row) => acc + (numberValue(row[key]) ?? 0), 0)
  return total > 0 ? total : undefined
}

function weightedAverage(rows: ParsedReportRow[], key: string, weightKey = 'views'): number | undefined {
  let weighted = 0
  let totalWeight = 0
  rows.forEach((row) => {
    const value = numberValue(row[key])
    const weight = numberValue(row[weightKey]) ?? 0
    if (value !== undefined && weight > 0) {
      weighted += value * weight
      totalWeight += weight
    }
  })
  return totalWeight > 0 ? Number((weighted / totalWeight).toFixed(2)) : undefined
}

function compactMetricRow<T extends Record<string, unknown>>(row: T): Partial<T> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== '')) as Partial<T>
}

export function buildYouTubeAnalyticsSnapshotFromApiReports(args: {
  request: Omit<YouTubeAnalyticsIngestionRequest, 'accessToken' | 'refreshToken'>
  summaryReport: YouTubeAnalyticsReport
  trafficSourceReport?: YouTubeAnalyticsReport
  audienceReport?: YouTubeAnalyticsReport
  retentionReport?: YouTubeAnalyticsReport
  videos?: YouTubeVideoProject[]
}): Omit<YouTubeAnalyticsSnapshot, 'id' | 'importedAt' | 'importedBy' | 'importedByType' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType' | 'updatedBy' | 'updatedByType'> {
  const summaryRows = parseReportRows(args.summaryReport)
  const first = summaryRows[0] ?? {}
  const videosByYoutubeId = new Map(
    (args.videos ?? [])
      .filter((video) => typeof video.youtubeVideoId === 'string' && video.youtubeVideoId.trim())
      .map((video) => [video.youtubeVideoId!.trim(), video]),
  )
  const retentionRows = parseReportRows(args.retentionReport ?? {})
  const retentionPercentage = weightedAverage(retentionRows, 'audienceWatchRatio', 'elapsedVideoTimeRatio')
    ?? weightedAverage(retentionRows, 'relativeRetentionPerformance', 'elapsedVideoTimeRatio')
  const metrics = compactMetricRow({
    views: sum(summaryRows, 'views') ?? numberValue(first.views),
    watchTimeMinutes: sum(summaryRows, 'estimatedMinutesWatched') ?? numberValue(first.estimatedMinutesWatched),
    averageViewDurationSeconds: weightedAverage(summaryRows, 'averageViewDuration') ?? numberValue(first.averageViewDuration),
    averageViewPercentage: weightedAverage(summaryRows, 'averageViewPercentage') ?? numberValue(first.averageViewPercentage),
    retentionPercentage,
    impressions: sum(summaryRows, 'impressions') ?? numberValue(first.impressions),
    impressionsCtr: weightedAverage(summaryRows, 'impressionClickThroughRate') ?? numberValue(first.impressionClickThroughRate),
    subscribersGained: sum(summaryRows, 'subscribersGained') ?? numberValue(first.subscribersGained),
    subscribersLost: sum(summaryRows, 'subscribersLost') ?? numberValue(first.subscribersLost),
    likes: sum(summaryRows, 'likes') ?? numberValue(first.likes),
    comments: sum(summaryRows, 'comments') ?? numberValue(first.comments),
    shares: sum(summaryRows, 'shares') ?? numberValue(first.shares),
    trafficSources: parseReportRows(args.trafficSourceReport ?? {}).flatMap((row) => {
      const source = stringValue(row.insightTrafficSourceType)
      if (!source) return []
      return [compactMetricRow({
        source,
        views: numberValue(row.views),
        watchTimeMinutes: numberValue(row.estimatedMinutesWatched),
      })]
    }),
    audience: parseReportRows(args.audienceReport ?? {}).flatMap((row) => {
      const segment = [stringValue(row.ageGroup), stringValue(row.gender)].filter(Boolean).join(' / ')
      if (!segment) return []
      return [compactMetricRow({
        segment,
        viewerPercentage: numberValue(row.viewerPercentage),
        views: numberValue(row.views),
        watchTimeMinutes: numberValue(row.estimatedMinutesWatched),
      })]
    }),
    shortsVsLongForm: summaryRows.length > 1
      ? Object.values(summaryRows.reduce<Record<string, { videoType: 'short' | 'long_form'; views: number; watchTimeMinutes: number; averageViewPercentageTotal: number; rows: number }>>((acc, row) => {
          const youtubeVideoId = stringValue(row.video)
          const video = youtubeVideoId ? videosByYoutubeId.get(youtubeVideoId) : undefined
          const videoType = video?.videoType === 'short' ? 'short' : 'long_form'
          acc[videoType] ??= { videoType, views: 0, watchTimeMinutes: 0, averageViewPercentageTotal: 0, rows: 0 }
          acc[videoType].views += numberValue(row.views) ?? 0
          acc[videoType].watchTimeMinutes += numberValue(row.estimatedMinutesWatched) ?? 0
          acc[videoType].averageViewPercentageTotal += numberValue(row.averageViewPercentage) ?? 0
          acc[videoType].rows += 1
          return acc
        }, {})).map((row) => compactMetricRow({
          videoType: row.videoType,
          views: row.views || undefined,
          watchTimeMinutes: row.watchTimeMinutes || undefined,
          averageViewPercentage: row.rows ? Number((row.averageViewPercentageTotal / row.rows).toFixed(2)) : undefined,
        }))
      : [],
    seriesTrends: summaryRows.flatMap((row) => {
      const youtubeVideoId = stringValue(row.video)
      const video = youtubeVideoId ? videosByYoutubeId.get(youtubeVideoId) : undefined
      if (!video?.seriesId) return []
      return [compactMetricRow({
        seriesId: video.seriesId,
        views: numberValue(row.views),
        watchTimeMinutes: numberValue(row.estimatedMinutesWatched),
        averageViewPercentage: numberValue(row.averageViewPercentage),
      })]
    }),
    videoComparisons: summaryRows.flatMap((row) => {
      const youtubeVideoId = stringValue(row.video)
      const video = youtubeVideoId ? videosByYoutubeId.get(youtubeVideoId) : undefined
      if (!youtubeVideoId && !video?.id) return []
      return [compactMetricRow({
        videoProjectId: video?.id,
        youtubeVideoId,
        title: video?.title,
        views: numberValue(row.views),
        watchTimeMinutes: numberValue(row.estimatedMinutesWatched),
        impressionsCtr: numberValue(row.impressionClickThroughRate),
        averageViewPercentage: numberValue(row.averageViewPercentage),
      })]
    }),
  }) as YouTubeAnalyticsMetrics

  return {
    orgId: args.request.orgId,
    channelWorkspaceId: args.request.channelWorkspaceId,
    videoProjectId: args.request.videoProjectId,
    youtubeVideoId: args.request.youtubeVideoId,
    seriesId: args.request.seriesId,
    periodStart: args.request.periodStart,
    periodEnd: args.request.periodEnd,
    source: 'youtube_analytics_api',
    sourceFreshness: 'delayed',
    metrics,
    dimensions: Object.fromEntries(Object.entries({
      youtubeChannelId: args.request.youtubeChannelId,
      youtubeVideoId: args.request.youtubeVideoId,
    }).filter(([, value]) => typeof value === 'string' && value.trim())) as Record<string, string>,
    recommendations: buildAnalyticsRecommendations(metrics),
    clientSummary: buildClientSummary(metrics, args.request.periodStart, args.request.periodEnd),
    visibility: { showInClientPortal: false },
    deleted: false,
  }
}

export function buildAnalyticsRecommendations(metrics: YouTubeAnalyticsMetrics): YouTubeAnalyticsRecommendation[] {
  const recommendations: YouTubeAnalyticsRecommendation[] = []
  if ((metrics.impressionsCtr ?? 0) > 0 && (metrics.impressionsCtr ?? 0) < 3) {
    recommendations.push({
      type: 'thumbnail_test',
      summary: 'Low click-through rate: create a thumbnail/title test task before the next upload.',
      confidence: 'high',
      status: 'suggested',
      actionType: 'task',
    })
  }
  const retentionSignal = metrics.retentionPercentage ?? metrics.averageViewPercentage
  if ((retentionSignal ?? 100) < 35) {
    recommendations.push({
      type: 'retitle',
      summary: 'Weak retention: revise the hook and first script section for the next cut.',
      confidence: 'medium',
      status: 'suggested',
      actionType: 'script_change',
    })
  }
  const shortsViews = metrics.shortsVsLongForm?.find((row) => row.videoType === 'short')?.views ?? 0
  const longViews = metrics.shortsVsLongForm?.find((row) => row.videoType === 'long_form')?.views ?? 0
  if (shortsViews > longViews * 1.5 && shortsViews > 0) {
    recommendations.push({
      type: 'shorts_pack',
      summary: 'Shorts are outperforming long-form: turn the top theme into a clip pack idea.',
      confidence: 'medium',
      status: 'suggested',
      actionType: 'clip_idea',
    })
  }
  if ((metrics.seriesTrends?.length ?? 0) >= 2) {
    recommendations.push({
      type: 'series_change',
      summary: 'Series-level signal detected: brief a follow-up episode or series experiment from the strongest trend.',
      confidence: 'medium',
      status: 'suggested',
      actionType: 'series_experiment',
    })
  }
  if (!recommendations.length && (metrics.views ?? 0) > 0) {
    recommendations.push({
      type: 'follow_up_video',
      summary: 'Package the strongest topic into a next-video brief while the signal is fresh.',
      confidence: 'low',
      status: 'suggested',
      actionType: 'brief',
    })
  }
  return recommendations
}

function buildClientSummary(metrics: YouTubeAnalyticsMetrics, periodStart: string, periodEnd: string): string | undefined {
  const parts = [
    metrics.views !== undefined ? `${metrics.views} views` : null,
    metrics.watchTimeMinutes !== undefined ? `${metrics.watchTimeMinutes} watch minutes` : null,
    metrics.impressionsCtr !== undefined ? `${metrics.impressionsCtr}% CTR` : null,
    metrics.averageViewPercentage !== undefined ? `${metrics.averageViewPercentage}% average viewed` : null,
  ].filter(Boolean)
  return parts.length ? `YouTube analytics for ${periodStart} to ${periodEnd}: ${parts.join(', ')}.` : undefined
}

function youtubeOAuthClient(accessToken?: string, refreshToken?: string | null) {
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim()
  const oauth = new google.auth.OAuth2(clientId, clientSecret)
  oauth.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken ?? undefined,
  })
  return oauth
}

type ReportQueryParams = Record<string, string | undefined>

async function queryReport(auth: ReturnType<typeof youtubeOAuthClient>, params: ReportQueryParams): Promise<YouTubeAnalyticsReport> {
  const analytics = google.youtubeAnalytics({ version: 'v2', auth })
  const query = Object.fromEntries(Object.entries(params).filter(([, value]) => typeof value === 'string' && value.trim())) as Record<string, string>
  const response = await analytics.reports.query(query)
  return response.data as YouTubeAnalyticsReport
}

export async function fetchYouTubeAnalyticsApiSnapshot(request: YouTubeAnalyticsIngestionRequest) {
  if (!request.accessToken && !request.refreshToken) {
    throw new Error('A connected YouTube account with OAuth tokens is required')
  }
  const auth = youtubeOAuthClient(request.accessToken, request.refreshToken)
  const ids = 'channel==MINE'
  const base = {
    ids,
    startDate: request.periodStart,
    endDate: request.periodEnd,
  }
  const filters = request.youtubeVideoId ? { filters: `video==${request.youtubeVideoId}` } : {}
  const videoFilter = request.videos?.map((video) => video.youtubeVideoId).filter(Boolean).join(',')
  const comparisonFilters = videoFilter ? { filters: `video==${videoFilter}` } : filters

  const [summaryReport, trafficSourceReport, audienceReport, retentionReport] = await Promise.all([
    queryReport(auth, {
      ...base,
      ...comparisonFilters,
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,impressions,impressionClickThroughRate,subscribersGained,subscribersLost,likes,comments,shares',
      dimensions: videoFilter ? 'video' : undefined,
    }),
    queryReport(auth, {
      ...base,
      ...filters,
      metrics: 'views,estimatedMinutesWatched',
      dimensions: 'insightTrafficSourceType',
    }),
    queryReport(auth, {
      ...base,
      ...filters,
      metrics: 'viewerPercentage',
      dimensions: 'ageGroup,gender',
    }),
    request.youtubeVideoId
      ? queryReport(auth, {
          ...base,
          ...filters,
          metrics: 'audienceWatchRatio,relativeRetentionPerformance',
          dimensions: 'elapsedVideoTimeRatio',
        })
      : Promise.resolve({}),
  ])

  return buildYouTubeAnalyticsSnapshotFromApiReports({
    request,
    summaryReport,
    trafficSourceReport,
    audienceReport,
    retentionReport,
    videos: request.videos,
  })
}
