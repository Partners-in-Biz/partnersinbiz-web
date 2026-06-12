/**
 * POST /api/v1/campaigns/[id]/schedule
 *
 * Bulk-schedule every approved social_post + video on a campaign across the
 * campaign's calendar (preferred) or a simple cadence (fallback).
 *
 * Body:
 * {
 *   startDate?: string          // ISO date — defaults to next Monday at 09:00 SAST
 *   mode?: 'calendar' | 'cadence' | 'auto'   // default 'auto' (calendar if present)
 *   cadence?: {
 *     postsPerDay?: number      // default 1
 *     hours?: string[]          // default ['09:00']
 *     daysOfWeek?: number[]     // 0=Sun..6=Sat, default [1,3,5] (Mon/Wed/Fri)
 *   }
 *   platforms?: string[]        // filter (e.g. ['instagram','linkedin']) — default: all
 *   includePending?: boolean    // also schedule pending_approval posts (auto-approve them) — default true
 *   timezone?: string           // IANA, default 'Africa/Johannesburg'
 *   dryRun?: boolean            // preview without writing — default false
 * }
 *
 * Returns: { scheduled[], skipped[], totals, startDate, endDate }
 *
 * Each scheduled post gets:
 *   - scheduledFor + scheduledAt = timestamp
 *   - status = 'scheduled'
 *   - a matching social_queue entry (created here directly so the cron worker
 *     picks it up).
 */
import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { lastActorFrom } from '@/lib/api/actor'
import { logActivity } from '@/lib/activity/log'
import type { ApiUser } from '@/lib/api/types'
import { validateOutboundLinks } from '@/lib/social/outbound-link-validation'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type RouteContext = { params: Promise<{ id: string }> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any

interface Cadence {
  postsPerDay: number
  hours: string[]
  daysOfWeek: number[]
}

const DEFAULT_CADENCE: Cadence = {
  postsPerDay: 1,
  hours: ['09:00'],
  daysOfWeek: [1, 3, 5], // Mon / Wed / Fri
}

function nextMonday09(tz = 'Africa/Johannesburg'): Date {
  const now = new Date()
  // Find next Monday
  const day = now.getDay() // 0=Sun
  const daysUntilMon = ((1 - day + 7) % 7) || 7
  const mon = new Date(now)
  mon.setDate(now.getDate() + daysUntilMon)
  // Set local 09:00 in given TZ — naive: treat as ISO 09:00+02 for SAST
  // For other TZs the body should pass an explicit ISO startDate.
  const iso = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}T09:00:00+02:00`
  return new Date(iso)
}

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':').map(s => parseInt(s, 10))
  return { h: isFinite(h) ? h : 9, m: isFinite(m) ? m : 0 }
}

function setLocalHour(d: Date, h: number, m: number, tzOffsetHours = 2): Date {
  // Build an ISO with explicit offset (default +02 SAST). For full TZ support
  // a user would pass startDate in ISO format directly.
  const sign = tzOffsetHours >= 0 ? '+' : '-'
  const abs = Math.abs(tzOffsetHours)
  const off = `${sign}${String(abs).padStart(2, '0')}:00`
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${off}`
  return new Date(iso)
}

interface Slot {
  date: Date
}

function buildCadenceSlots(start: Date, count: number, cadence: Cadence): Slot[] {
  const slots: Slot[] = []
  const cursor = new Date(start)
  let safety = 0
  while (slots.length < count && safety < 365) {
    const dow = cursor.getDay()
    if (cadence.daysOfWeek.includes(dow)) {
      for (const hm of cadence.hours.slice(0, cadence.postsPerDay)) {
        const { h, m } = parseHm(hm)
        const d = setLocalHour(new Date(cursor), h, m)
        slots.push({ date: d })
        if (slots.length >= count) break
      }
    }
    cursor.setDate(cursor.getDate() + 1)
    safety++
  }
  return slots
}

function calendarSlots(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  calendar: any[] | undefined,
  start: Date,
  cadence: Cadence,
): Slot[] {
  if (!Array.isArray(calendar) || calendar.length === 0) return []
  const slots: Slot[] = []
  const startMs = start.getTime()
  for (const entry of calendar) {
    if (!entry?.date) continue
    const d = new Date(entry.date)
    if (isNaN(d.getTime())) continue
    if (d.getTime() < startMs) continue
    const { h, m } = parseHm(cadence.hours[0] ?? '09:00')
    slots.push({ date: setLocalHour(d, h, m) })
  }
  // Sort + dedupe by ISO
  const seen = new Set<string>()
  return slots
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .filter(s => {
      const k = s.date.toISOString()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
}

export const POST = withAuth(
  'client',
  withIdempotency(async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { id } = await (context as RouteContext).params
    const body = await req.json().catch(() => ({}))

    // Verify campaign + tenant
    const campaignSnap = await adminDb.collection('campaigns').doc(id).get()
    if (!campaignSnap.exists) return apiError('Campaign not found', 404)
    const campaign = campaignSnap.data() as AnyObj
    if (campaign.deleted) return apiError('Campaign not found', 404)
    const scope = resolveOrgScope(user, (campaign.orgId as string | undefined) ?? null)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const orgId = scope.orgId

    // Resolve options
    const tz = typeof body.timezone === 'string' ? body.timezone : 'Africa/Johannesburg'
    const startDate = body.startDate ? new Date(body.startDate) : nextMonday09(tz)
    if (isNaN(startDate.getTime())) return apiError('Invalid startDate', 400)
    const mode = (body.mode as 'calendar' | 'cadence' | 'auto') ?? 'auto'
    const includePending = body.includePending !== false
    const platformsFilter: string[] | null = Array.isArray(body.platforms)
      ? body.platforms.map((p: unknown) => String(p).toLowerCase())
      : null
    const dryRun = body.dryRun === true
    const cadence: Cadence = {
      postsPerDay: body.cadence?.postsPerDay ?? DEFAULT_CADENCE.postsPerDay,
      hours: Array.isArray(body.cadence?.hours) && body.cadence.hours.length > 0
        ? body.cadence.hours
        : DEFAULT_CADENCE.hours,
      daysOfWeek: Array.isArray(body.cadence?.daysOfWeek) && body.cadence.daysOfWeek.length > 0
        ? body.cadence.daysOfWeek
        : DEFAULT_CADENCE.daysOfWeek,
    }

    // Pull eligible posts: status in (approved) or (approved + pending_approval)
    const eligible = includePending ? ['approved', 'pending_approval'] : ['approved']
    const postsSnap = await adminDb
      .collection('social_posts')
      .where('orgId', '==', orgId)
      .where('campaignId', '==', id)
      .get()

    const allPosts = postsSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as AnyObj))
      .filter(p => eligible.includes(p.status))
      .filter(p => {
        if (!platformsFilter) return true
        const plat = (Array.isArray(p.platforms) ? p.platforms[0] : p.platform) ?? ''
        return platformsFilter.includes(String(plat).toLowerCase())
      })

    // Sort by createdAt for stable assignment
    allPosts.sort((a, b) => {
      const at = (a.createdAt?._seconds ?? a.createdAt?.seconds ?? 0)
      const bt = (b.createdAt?._seconds ?? b.createdAt?.seconds ?? 0)
      return at - bt
    })

    if (allPosts.length === 0) {
      return apiSuccess({
        scheduled: [],
        skipped: [],
        totals: { scheduled: 0, skipped: 0, eligible: 0 },
        startDate: startDate.toISOString(),
        endDate: startDate.toISOString(),
        mode,
        dryRun,
      })
    }

    // Build slot list
    let slots: Slot[] = []
    if (mode === 'calendar' || mode === 'auto') {
      slots = calendarSlots(campaign.calendar, startDate, cadence)
    }
    if (slots.length < allPosts.length) {
      // Top up with cadence-generated slots
      const lastDate = slots.length > 0 ? slots[slots.length - 1].date : startDate
      const extra = buildCadenceSlots(
        new Date(lastDate.getTime() + 24 * 60 * 60 * 1000),
        allPosts.length - slots.length,
        cadence,
      )
      slots.push(...extra)
    }

    // Walk + write
    const scheduled: AnyObj[] = []
    const skipped: AnyObj[] = []

    if (dryRun) {
      for (let i = 0; i < allPosts.length; i++) {
        scheduled.push({
          postId: allPosts[i].id,
          platform: allPosts[i].platforms?.[0] ?? allPosts[i].platform,
          scheduledFor: slots[i].date.toISOString(),
          status: 'scheduled (dry-run)',
        })
      }
    } else {
      const batch = adminDb.batch()
      const queueWrites: Array<{ ref: FirebaseFirestore.DocumentReference; data: AnyObj }> = []

      for (let i = 0; i < allPosts.length; i++) {
        const p = allPosts[i]
        const contentText = typeof p.content === 'string' ? p.content : p.content?.text
        if (contentText) {
          const linkValidation = await validateOutboundLinks(contentText)
          if (!linkValidation.valid) {
            skipped.push({
              postId: p.id,
              platform: p.platforms?.[0] ?? p.platform,
              reason: linkValidation.errors.map(e => e.message).join('; '),
            })
            continue
          }
        }

        const slot = slots[i]
        const ts = Timestamp.fromDate(slot.date)
        const postRef = adminDb.collection('social_posts').doc(p.id)
        // Auto-approve pending posts if includePending
        const newStatus = 'scheduled'
        const update: AnyObj = {
          scheduledFor: ts,
          scheduledAt: ts,
          status: newStatus,
          ...lastActorFrom(user),
        }
        if (p.status === 'pending_approval' && includePending) {
          update.approvedAt = FieldValue.serverTimestamp()
          update.approvedBy = user.uid
        }
        batch.update(postRef, update)

        // Queue entry
        const queueRef = adminDb.collection('social_queue').doc(p.id)
        queueWrites.push({
          ref: queueRef,
          data: {
            orgId,
            postId: p.id,
            scheduledAt: ts,
            status: 'pending',
            priority: 0,
            attempts: 0,
            maxAttempts: 5,
            lastAttemptAt: null,
            nextRetryAt: null,
            backoffSeconds: 60,
            lockedBy: null,
            lockedAt: null,
            startedAt: null,
            completedAt: null,
            error: null,
            createdAt: FieldValue.serverTimestamp(),
          },
        })

        scheduled.push({
          postId: p.id,
          platform: p.platforms?.[0] ?? p.platform,
          scheduledFor: slot.date.toISOString(),
          status: 'scheduled',
        })
      }

      await batch.commit()
      // Queue writes via merge so re-running schedules safely
      for (const w of queueWrites) {
        await w.ref.set(w.data, { merge: true })
      }
    }

    const sortedDates = scheduled.map(s => new Date(s.scheduledFor)).sort((a, b) => a.getTime() - b.getTime())
    const startIso = sortedDates[0]?.toISOString() ?? startDate.toISOString()
    const endIso = sortedDates[sortedDates.length - 1]?.toISOString() ?? startDate.toISOString()

    if (!dryRun && scheduled.length > 0) {
      logActivity({
        orgId,
        type: 'campaign_scheduled',
        actorId: user.uid,
        actorName: user.uid,
        actorRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
        description: `Scheduled ${scheduled.length} post${scheduled.length === 1 ? '' : 's'} on campaign "${campaign.name ?? id}" (${startIso.slice(0, 10)} → ${endIso.slice(0, 10)})`,
        entityId: id,
        entityType: 'webhook',
        entityTitle: campaign.name ?? id,
      }).catch(() => {})
    }

    return apiSuccess({
      scheduled,
      skipped,
      totals: { scheduled: scheduled.length, skipped: skipped.length, eligible: allPosts.length },
      startDate: startIso,
      endDate: endIso,
      mode,
      dryRun,
    })
  }),
)
