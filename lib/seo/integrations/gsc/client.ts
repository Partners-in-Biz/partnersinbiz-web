import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

export interface SearchAnalyticsRow {
  page: string
  query: string
  impressions: number
  clicks: number
  ctr: number
  position: number
}

export async function fetchSearchAnalytics(
  auth: OAuth2Client,
  siteUrl: string,
  startDate: string,
  endDate: string,
): Promise<SearchAnalyticsRow[]> {
  const wm = google.webmasters({ version: 'v3', auth })
  const res = await wm.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ['page', 'query'],
      rowLimit: 5000,
    },
  })
  return (res.data.rows ?? []).map((r) => ({
    page: r.keys?.[0] ?? '',
    query: r.keys?.[1] ?? '',
    impressions: r.impressions ?? 0,
    clicks: r.clicks ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  }))
}

export async function submitSitemap(
  auth: OAuth2Client,
  siteUrl: string,
  sitemapUrl: string,
): Promise<void> {
  const wm = google.webmasters({ version: 'v3', auth })
  await wm.sitemaps.submit({
    siteUrl,
    feedpath: sitemapUrl,
  })
}

export async function inspectUrl(
  auth: OAuth2Client,
  inspectionUrl: string,
  siteUrl: string,
): Promise<{ coverageState: string; lastCrawlTime?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sc: any = (google as any).searchconsole({ version: 'v1', auth })
  const res = await sc.urlInspection.index.inspect({
    requestBody: { inspectionUrl, siteUrl },
  })
  const r = res.data?.inspectionResult?.indexStatusResult
  return { coverageState: r?.coverageState ?? 'UNKNOWN', lastCrawlTime: r?.lastCrawlTime ?? undefined }
}
