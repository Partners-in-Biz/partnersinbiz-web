import { NextRequest } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { computeFunnelResults, type FunnelSegment } from '@/lib/analytics/funnel-compute'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import { fetchSessions, classifyVisitors, tsToMillis } from '@/lib/analytics/query'
import { toCsv, csvResponse } from '@/lib/analytics/csv'
import type { ApiUser } from '@/lib/api/types'
import type { FunnelWindow, FunnelResults, FunnelStep } from '@/lib/analytics/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

interface EnrichedEvent {
  event: string
  distinctId: string
  sessionId: string
  timestamp: number
  properties: Record<string, unknown>
  device: string | null
  utmSource: string | null
  returning: boolean
}

/** Fetch funnel events for a range, enriched with session attributes for segmenting. */
async function computeForRange(
  propertyId: string,
  orgId: string,
  steps: FunnelStep[],
  window: FunnelWindow,
  from: Date,
  to: Date,
  segment: FunnelSegment | null,
): Promise<FunnelResults> {
  const stepEvents = steps.map(s => s.event)

  const eventsSnap = await adminDb.collection('product_events')
    .where('propertyId', '==', propertyId)
    .where('serverTime', '>=', Timestamp.fromDate(from))
    .where('serverTime', '<=', Timestamp.fromDate(to))
    .orderBy('serverTime', 'asc')
    .limit(30000)
    .get()

  // Session attributes for device/source/returning segmentation.
  const sessions = await fetchSessions(propertyId, { from, to })
  const classes = classifyVisitors(sessions)
  const sessionAttr = new Map(sessions.map(s => [s.id, { device: s.device, utmSource: s.utmSource }]))

  const rawEvents: EnrichedEvent[] = eventsSnap.docs
    .map(d => {
      const data = d.data()
      const attr = sessionAttr.get(data.sessionId)
      return {
        event: data.event as string,
        distinctId: data.distinctId as string,
        sessionId: data.sessionId as string,
        timestamp: tsToMillis(data.serverTime) || tsToMillis(data.timestamp),
        properties: (data.properties ?? {}) as Record<string, unknown>,
        device: attr?.device ?? data.device ?? null,
        utmSource: attr?.utmSource ?? null,
        returning: classes.get(data.distinctId as string) === 'returning',
      }
    })
    .filter(e => stepEvents.includes(e.event))

  return computeFunnelResults(rawEvents, steps, window, segment)
}

function parseFunnelSegment(searchParams: URLSearchParams): FunnelSegment | null {
  const visitorType = searchParams.get('visitorType') as FunnelSegment['visitorType'] | null
  const device = searchParams.get('device')
  const source = searchParams.get('source')
  if (!visitorType && !device && !source) return null
  return {
    visitorType: visitorType ?? 'all',
    device: device ?? null,
    source: source ?? null,
  }
}

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: unknown) => {
  const { id } = await (ctx as RouteContext).params
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!from || !to) return apiError('from and to query params are required', 400)
  if (isNaN(new Date(from).getTime())) return apiError('Invalid from date', 400)
  if (isNaN(new Date(to).getTime())) return apiError('Invalid to date', 400)

  const segment = parseFunnelSegment(searchParams)
  const format = searchParams.get('format')
  // Compare second range (US-133)
  const compareFrom = searchParams.get('compareFrom')
  const compareTo = searchParams.get('compareTo')

  try {
    const funnelSnap = await adminDb.collection('product_funnels').doc(id).get()
    if (!funnelSnap.exists) return apiError('Funnel not found', 404)
    const funnel = funnelSnap.data()!
    const property = await requireAnalyticsProperty(user, { propertyId: funnel.propertyId })
    const steps = funnel.steps as FunnelStep[]
    const window = funnel.window as FunnelWindow

    const results = await computeForRange(
      property.id, property.orgId, steps, window,
      new Date(from), new Date(to), segment,
    )

    let compare: FunnelResults | null = null
    if (compareFrom && compareTo &&
        !isNaN(new Date(compareFrom).getTime()) && !isNaN(new Date(compareTo).getTime())) {
      compare = await computeForRange(
        property.id, property.orgId, steps, window,
        new Date(compareFrom), new Date(compareTo), segment,
      )
    }

    if (format === 'csv') {
      const csv = toCsv(
        ['step', 'event', 'count', 'conversionFromPrev'],
        results.steps.map((s, i) => ({
          step: i + 1, event: s.event, count: s.count,
          conversionFromPrev: s.conversionFromPrev ?? '',
        })),
      )
      return csvResponse(`funnel-${id}.csv`, csv)
    }

    return apiSuccess(compare ? { ...results, compare } : results)
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-funnel-results]', e)
    return apiError('Failed to compute funnel results', 500)
  }
})
