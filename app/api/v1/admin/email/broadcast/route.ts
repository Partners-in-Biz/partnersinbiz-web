/**
 * Platform mass-email broadcasts — `admin_email_broadcasts`.
 *
 * GET  /api/v1/admin/email/broadcast            — broadcast history (newest first).
 * GET  /api/v1/admin/email/broadcast?count=1&source=&role=&orgId=
 *                                                — live recipient count for the picker.
 * POST /api/v1/admin/email/broadcast            — send now / schedule a broadcast.
 *   Body: { subject, html, recipientFilter:{source,role?,orgId?},
 *           mode?: 'send'|'schedule', scheduledFor? }
 *
 * Sends through the REAL provider wrapper (sendCampaignEmail). Recipients are
 * resolved from the real `users`/`organizations` collections and filtered
 * against the platform suppression list before send. Merge tags ({{firstName}},
 * {{email}} …) are interpolated per-recipient via lib/email/template.
 *
 * SEND MODEL: an immediate send dispatches inline up to MAX_INLINE_SEND
 * recipients (bounded so the request can't time out). Larger audiences — or any
 * scheduled send — are recorded as 'scheduled'/'queued' with the resolved
 * recipient count; a worker is the integration point that drains them (see the
 * handoff report). We NEVER fake a sentCount: it reflects only real provider
 * accepts.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'
import {
  sendCampaignEmail,
  htmlToPlainText,
} from '@/lib/email/resend'
import { interpolate, type TemplateVars } from '@/lib/email/template'
import { getSuppressedEmails } from '@/lib/email/suppressions'
import {
  SHARED_SENDER_DOMAIN,
  SHARED_SENDER_LOCAL,
  SHARED_SENDER_NAME,
} from '@/lib/platform/constants'
import { readEmailControls } from '../controls/store'
import {
  resolveRecipients,
  countRecipients,
  describeFilter,
  type RecipientFilter,
  type RecipientSource,
} from './recipients'

export const dynamic = 'force-dynamic'

const COLLECTION = 'admin_email_broadcasts'
// Inline-send cap. Beyond this we record the broadcast as queued for a worker.
const MAX_INLINE_SEND = 200

const SOURCES: RecipientSource[] = ['all_users', 'by_role', 'by_org']

function parseFilter(input: unknown): RecipientFilter | null {
  if (!input || typeof input !== 'object') return null
  const f = input as Record<string, unknown>
  const source = f.source as RecipientSource
  if (!SOURCES.includes(source)) return null
  const filter: RecipientFilter = { source }
  if (source === 'by_role') {
    const role = (f.role ?? '').toString().trim()
    if (!role) return null
    filter.role = role
  }
  if (source === 'by_org') {
    const orgId = (f.orgId ?? '').toString().trim()
    if (!orgId) return null
    filter.orgId = orgId
  }
  return filter
}

function tsToIso(v: unknown): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (v as any)?.toDate?.()
  if (d instanceof Date) return d.toISOString()
  if (typeof v === 'string') return v
  return null
}

export const GET = withAuth('admin', async (req: NextRequest) => {
  const { searchParams } = new URL(req.url)

  // Live audience count for the picker.
  if (searchParams.get('count') === '1') {
    const filter = parseFilter({
      source: searchParams.get('source'),
      role: searchParams.get('role') ?? undefined,
      orgId: searchParams.get('orgId') ?? undefined,
    })
    if (!filter) return apiError('Invalid recipient filter')
    const count = await countRecipients(filter)
    return apiSuccess({ count, description: describeFilter(filter) })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snap: any
  try {
    snap = await adminDb.collection(COLLECTION).orderBy('createdAt', 'desc').limit(100).get()
  } catch {
    snap = await adminDb.collection(COLLECTION).limit(100).get()
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = snap.docs.map((d: any) => {
    const data = d.data() ?? {}
    return {
      id: d.id,
      subject: data.subject ?? '',
      status: data.status ?? 'draft',
      recipientFilter: data.recipientFilter ?? null,
      recipientDescription: data.recipientDescription ?? '',
      recipientCount: data.recipientCount ?? 0,
      sentCount: data.sentCount ?? 0,
      failedCount: data.failedCount ?? 0,
      suppressedCount: data.suppressedCount ?? 0,
      scheduledFor: tsToIso(data.scheduledFor),
      sentAt: tsToIso(data.sentAt),
      createdAt: tsToIso(data.createdAt),
      createdBy: data.createdBy ?? '',
    }
  })
  return apiSuccess(rows)
})

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => ({}))
  const subject = (typeof body.subject === 'string' ? body.subject : '').trim()
  const html = typeof body.html === 'string' ? body.html : ''
  const filter = parseFilter(body.recipientFilter)
  const mode: 'send' | 'schedule' = body.mode === 'schedule' ? 'schedule' : 'send'

  if (!subject) return apiError('subject is required')
  if (!html.trim()) return apiError('html content is required')
  if (!filter) return apiError('A valid recipientFilter is required')

  let scheduledForMs: number | null = null
  if (mode === 'schedule') {
    const raw = body.scheduledFor
    const ms = typeof raw === 'number' ? raw : Date.parse(String(raw ?? ''))
    if (!Number.isFinite(ms)) return apiError('scheduledFor must be a valid date/time')
    if (ms < Date.now() - 60_000) return apiError('scheduledFor must be in the future')
    scheduledForMs = ms
  }

  const controls = await readEmailControls()
  const actor = actorFrom(user)

  // Resolve the audience now so we record a real recipient count.
  const recipients = await resolveRecipients(filter)
  const recipientCount = recipients.length
  const description = describeFilter(filter)

  const base = {
    subject,
    html,
    recipientFilter: filter,
    recipientDescription: description,
    recipientCount,
    sentCount: 0,
    failedCount: 0,
    suppressedCount: 0,
    scheduledFor: scheduledForMs ? new Date(scheduledForMs) : null,
    sentAt: null as Date | null,
    ...actor,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  // Schedule, paused platform, empty audience, or oversized audience → record
  // as scheduled/queued. A worker is the integration point that drains these.
  const mustQueue =
    mode === 'schedule' ||
    controls.pauseOutbound ||
    recipientCount === 0 ||
    recipientCount > MAX_INLINE_SEND

  if (mustQueue) {
    const status =
      mode === 'schedule'
        ? 'scheduled'
        : controls.pauseOutbound
          ? 'scheduled' // held until the pause lifts; the worker re-checks the flag
          : recipientCount === 0
            ? 'sent' // nothing to send — terminal, zero sentCount (honest)
            : 'scheduled'
    const ref = await adminDb.collection(COLLECTION).add({ ...base, status })
    return apiSuccess(
      {
        id: ref.id,
        status,
        recipientCount,
        queued: status === 'scheduled',
        note:
          status === 'scheduled'
            ? controls.pauseOutbound
              ? 'Outbound is paused — broadcast recorded as scheduled; a worker will dispatch once sending resumes.'
              : recipientCount > MAX_INLINE_SEND
                ? `Audience (${recipientCount}) exceeds the inline limit (${MAX_INLINE_SEND}); recorded as scheduled for the worker to dispatch.`
                : 'Recorded as scheduled.'
            : 'No matching recipients — nothing sent.',
      },
      201,
    )
  }

  // ── Inline send (bounded audience, send-now, not paused) ───────────────────
  const ref = await adminDb.collection(COLLECTION).add({ ...base, status: 'sending' })

  // Filter against the platform suppression list (org-less platform audience is
  // suppression-checked under each recipient's '' org context is N/A; platform
  // users are suppressed per the shared sender domain org key '__platform__').
  const PLATFORM_ORG = '__platform__'
  const emails = recipients.map((r) => r.email)
  const suppressed = await getSuppressedEmails(PLATFORM_ORG, emails, 'email')

  const from = `${SHARED_SENDER_NAME} <${SHARED_SENDER_LOCAL}@${SHARED_SENDER_DOMAIN}>`
  let sentCount = 0
  let failedCount = 0
  let suppressedCount = 0

  for (const r of recipients) {
    if (suppressed.has(r.email)) {
      suppressedCount += 1
      continue
    }
    const vars: TemplateVars = {
      firstName: r.firstName,
      lastName: '',
      email: r.email,
      name: r.displayName || r.firstName,
    }
    const subj = interpolate(subject, vars)
    const bodyHtml = interpolate(html, vars)
    const text = htmlToPlainText(bodyHtml)
    try {
      const result = await sendCampaignEmail({
        from,
        to: r.email,
        subject: subj,
        html: bodyHtml,
        text,
      })
      if (result.ok) sentCount += 1
      else failedCount += 1
    } catch {
      failedCount += 1
    }
  }

  await ref.update({
    status: 'sent',
    sentCount,
    failedCount,
    suppressedCount,
    sentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess(
    {
      id: ref.id,
      status: 'sent',
      recipientCount,
      sentCount,
      failedCount,
      suppressedCount,
    },
    201,
  )
})
