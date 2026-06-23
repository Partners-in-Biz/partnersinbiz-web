import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { analyticsPropertyErrorResponse, requireAnalyticsProperty } from '@/lib/analytics/property-access'
import { tsToMillis } from '@/lib/analytics/query'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

const SYSTEM_EVENTS = new Set(['$pageview', '$identify'])
const LOOKBACK_DAYS = 30

/**
 * GET — returns the custom-event registry merged with REAL trigger counts +
 * last-triggered timestamps pulled from product_events over the last 30 days.
 */
export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  if (!propertyId) return apiError('propertyId is required', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })

    const [defsSnap, eventsSnap] = await Promise.all([
      adminDb.collection('product_custom_events')
        .where('propertyId', '==', property.id)
        .get(),
      adminDb.collection('product_events')
        .where('propertyId', '==', property.id)
        .where('serverTime', '>=', Timestamp.fromDate(new Date(Date.now() - LOOKBACK_DAYS * 86400000)))
        .orderBy('serverTime', 'asc')
        .limit(30000)
        .get(),
    ])

    // Aggregate trigger counts + last-triggered per event name from real data.
    const stats = new Map<string, { count: number; last: number }>()
    for (const d of eventsSnap.docs) {
      const data = d.data()
      const name = data.event as string
      if (SYSTEM_EVENTS.has(name)) continue
      const ms = tsToMillis(data.serverTime)
      const s = stats.get(name) ?? { count: 0, last: 0 }
      s.count++
      if (ms > s.last) s.last = ms
      stats.set(name, s)
    }

    const defs = defsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>))
    const defByName = new Map(defs.map(d => [d.name as string, d]))

    // Merge: registered defs (even with 0 triggers) + discovered events not yet registered.
    const rows: Array<Record<string, unknown>> = []
    for (const def of defs) {
      const st = stats.get(def.name as string)
      rows.push({ ...def, registered: true, triggerCount: st?.count ?? 0, lastTriggered: st?.last ? new Date(st.last).toISOString() : null })
    }
    for (const [name, st] of stats) {
      if (defByName.has(name)) continue
      rows.push({ id: null, name, description: '', properties: [], registered: false, triggerCount: st.count, lastTriggered: st.last ? new Date(st.last).toISOString() : null })
    }
    rows.sort((a, b) => (b.triggerCount as number) - (a.triggerCount as number))

    return apiSuccess(rows)
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-custom-events-get]', e)
    return apiError('Failed to query custom events', 500)
  }
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  let body: { propertyId?: string; name?: string; description?: string; properties?: string[] }
  try { body = await req.json() } catch { return apiError('Invalid JSON', 400) }

  const { propertyId, name, description, properties } = body
  if (!propertyId) return apiError('propertyId is required', 400)
  if (!name?.trim()) return apiError('name is required', 400)

  try {
    const property = await requireAnalyticsProperty(user, { propertyId })
    // upsert by name within property
    const existing = await adminDb.collection('product_custom_events')
      .where('propertyId', '==', property.id)
      .where('name', '==', name.trim())
      .limit(1)
      .get()
    const payload = {
      orgId: property.orgId,
      propertyId: property.id,
      name: name.trim(),
      description: (description ?? '').trim(),
      properties: Array.isArray(properties) ? properties.filter(p => typeof p === 'string') : [],
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (!existing.empty) {
      await existing.docs[0].ref.update(payload)
      return apiSuccess({ id: existing.docs[0].id })
    }
    const ref = await adminDb.collection('product_custom_events').add({
      ...payload,
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
    })
    return apiSuccess({ id: ref.id }, 201)
  } catch (e) {
    const propertyError = analyticsPropertyErrorResponse(e)
    if (propertyError) return propertyError
    console.error('[analytics-custom-events-post]', e)
    return apiError('Failed to save custom event', 500)
  }
})
