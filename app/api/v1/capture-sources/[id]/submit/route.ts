// app/api/v1/capture-sources/[id]/submit/route.ts
//
// PUBLIC: capture-source embed submit endpoint, no auth.
//
// Accepts a JSON body { email, data?, referer? } and:
//   1. Finds the capture source by id (404 if missing / soft-deleted / inactive)
//   2. Validates the email
//   3. Looks up or creates the contact (merging tags / appending new field data)
//   4. Records the submission in `lead_capture_submissions`
//   5. If `doubleOptIn === 'on'`: sends a confirmation email and returns
//      `requiresConfirmation: true`. Enrollment is deferred until the
//      confirmation page is visited.
//      Otherwise: runs `performAutoEnroll` immediately and marks the
//      submission `confirmedAt`.
//   6. Fires `notifyEmails` notification to org admins (best-effort)
//
// CORS is open (`*`) because the endpoint is meant to be called from any
// client site that hosts the embed widget.

import { NextRequest, NextResponse } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { sendCampaignEmail, htmlToPlainText } from '@/lib/email/resend'
import { resolveFrom } from '@/lib/email/resolveFrom'
import { signConfirmToken } from '@/lib/lead-capture/token'
import { performAutoEnroll } from '@/lib/lead-capture/autoEnroll'
import { deliverCaptureWebhook } from '@/lib/lead-capture/webhook'
import { isDisposableEmail } from '@/lib/lead-capture/disposable-domains'
import { verifyTurnstileToken } from '@/lib/forms/turnstile'
import {
  type CaptureSource,
  type CaptureSubmission,
  type CaptureSourceRateLimit,
  DEFAULT_RATE_LIMIT,
  LEAD_CAPTURE_SOURCES,
  LEAD_CAPTURE_SUBMISSIONS,
} from '@/lib/lead-capture/types'

const RATE_LIMIT_COLLECTION = 'lead_capture_rate_limits'

type BlockReason = 'honeypot' | 'rateLimit' | 'disposable' | 'captcha'

function resolveRateLimit(source: CaptureSource): CaptureSourceRateLimit {
  const r = source.rateLimit
  if (!r || typeof r !== 'object') return { ...DEFAULT_RATE_LIMIT }
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_RATE_LIMIT.enabled,
    maxPerHourPerIp: Number.isFinite(r.maxPerHourPerIp) && r.maxPerHourPerIp > 0
      ? r.maxPerHourPerIp
      : DEFAULT_RATE_LIMIT.maxPerHourPerIp,
    maxPerDayPerEmail: Number.isFinite(r.maxPerDayPerEmail) && r.maxPerDayPerEmail > 0
      ? r.maxPerDayPerEmail
      : DEFAULT_RATE_LIMIT.maxPerDayPerEmail,
  }
}

function sanitiseKeyPart(s: string): string {
  return (s || 'unknown').replace(/[^a-zA-Z0-9:.\-_@]/g, '_').slice(0, 120)
}

function turnstileConfigured(source: CaptureSource): boolean {
  return (
    source.turnstileEnabled === true &&
    typeof source.turnstileSiteKey === 'string' &&
    source.turnstileSiteKey.trim().length > 0 &&
    Boolean(process.env.TURNSTILE_SECRET_KEY)
  )
}

/**
 * Atomically increment-and-check a Firestore-backed counter for a deterministic
 * bucket id. Returns true if the caller is still under `max`, false if the
 * request would exceed the cap. Fails open on Firestore errors (so legitimate
 * users are never blocked by infra problems).
 */
async function checkAndIncrement(
  docId: string,
  max: number,
  ttlMs: number,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  if (!Number.isFinite(max) || max <= 0) return true
  const ref = adminDb.collection(RATE_LIMIT_COLLECTION).doc(docId)
  try {
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const current = (snap.exists ? (snap.data()?.count as number) : 0) ?? 0
      if (current >= max) return false
      if (snap.exists) {
        tx.update(ref, {
          count: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        })
      } else {
        tx.set(ref, {
          ...metadata,
          count: 1,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + ttlMs),
        })
      }
      return true
    })
  } catch {
    // Fail open — don't block real submissions on Firestore hiccups.
    return true
  }
}

async function recordBlock(sourceId: string, reason: BlockReason): Promise<void> {
  try {
    await adminDb.collection(LEAD_CAPTURE_SOURCES).doc(sourceId).update({
      [`stats.blocked.${reason}`]: FieldValue.increment(1),
    })
  } catch {
    // best-effort — never throw from a stats increment
  }
}

type Params = { params: Promise<{ id: string }> }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status, headers: CORS_HEADERS })
}

function jsonSuccess(data: Record<string, unknown>, status: number = 200): NextResponse {
  return NextResponse.json(data, { status, headers: CORS_HEADERS })
}

function isEmail(s: string): boolean {
  // Reject obvious spam patterns and require structure
  if (!s || typeof s !== 'string') return false
  if (s.length > 254) return false
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return false
  // Block trivial scammy local-parts that bots emit
  const local = s.split('@')[0]
  if (/^[a-z]{1,3}\d{6,}$/i.test(local)) return false
  return true
}

// US-097: pull UTM params from the request body (top-level or under `utm`/`data`)
// and the query string. Returns a map keyed by the canonical utm_* names; empty
// values are dropped.
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const

function extractUtm(req: NextRequest, body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  const search = new URL(req.url).searchParams
  const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>
  const utmObj = (body.utm && typeof body.utm === 'object' ? body.utm : {}) as Record<string, unknown>

  for (const key of UTM_KEYS) {
    // Precedence: explicit body utm object → top-level body → data object → query string
    const candidate =
      (typeof utmObj[key] === 'string' && utmObj[key]) ||
      (typeof body[key] === 'string' && (body[key] as string)) ||
      (typeof data[key] === 'string' && (data[key] as string)) ||
      search.get(key) ||
      ''
    const val = typeof candidate === 'string' ? candidate.trim() : ''
    if (val) out[key] = val.slice(0, 500)
  }
  return out
}

// Map a utm_* key to the camelCase contact field name (utm_source → utmSource).
function utmContactFields(utm: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {
    utm_source: 'utmSource',
    utm_medium: 'utmMedium',
    utm_campaign: 'utmCampaign',
    utm_term: 'utmTerm',
    utm_content: 'utmContent',
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(utm)) {
    const field = map[k]
    if (field && v) out[field] = v
  }
  return out
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  const first = fwd.split(',')[0]?.trim()
  return first || req.headers.get('x-real-ip') || 'unknown'
}

function appUrl(): string {
  const v = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'https://partnersinbiz.online'
  return v.replace(/\/$/, '')
}

function defaultConfirmHtml(opts: {
  confirmUrl: string
  orgName: string
  sourceName: string
}): string {
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #111; max-width: 560px; margin: 0 auto;">
  <h1 style="margin: 0 0 16px; font-size: 22px;">One quick step — confirm your subscription</h1>
  <p>Thanks for signing up to <strong>${opts.sourceName}</strong>. Please confirm your email so we know it's really you.</p>
  <p style="margin: 24px 0;">
    <a href="${opts.confirmUrl}" style="background: #0f766e; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">Confirm my email</a>
  </p>
  <p style="font-size: 13px; color: #555;">If you didn't sign up, you can safely ignore this message.</p>
  <p style="font-size: 12px; color: #888; margin-top: 32px;">— ${opts.orgName}</p>
</div>
  `.trim()
}

async function getOrgName(orgId: string): Promise<string> {
  try {
    const snap = await adminDb.collection('organizations').doc(orgId).get()
    if (snap.exists) {
      const name = snap.data()?.name
      if (typeof name === 'string' && name.trim()) return name
    }
  } catch {
    // ignore
  }
  return 'Our team'
}

async function sendAdminNotifications(opts: {
  source: CaptureSource
  submission: CaptureSubmission
  orgName: string
}): Promise<void> {
  const { source, submission, orgName } = opts
  if (!source.notifyEmails?.length) return
  const resolved = await resolveFrom({ orgName, fromLocal: 'notifications' })
  const subject = `New ${source.name} signup: ${submission.email}`
  const dataRows = Object.entries(submission.data || {})
    .map(([k, v]) => `<tr><td style="padding: 4px 12px 4px 0; color: #555;">${k}</td><td style="padding: 4px 0;">${v}</td></tr>`)
    .join('')
  const html = `
<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #111;">
  <p><strong>${submission.email}</strong> just submitted "${source.name}".</p>
  <table style="border-collapse: collapse; margin-top: 8px;">${dataRows}</table>
  <p style="color: #888; font-size: 12px; margin-top: 16px;">Source: ${source.id} · Contact: ${submission.contactId}</p>
</div>
  `.trim()
  const text = htmlToPlainText(html)

  await Promise.all(
    source.notifyEmails.map((to) =>
      sendCampaignEmail({
        from: resolved.from,
        to,
        subject,
        html,
        text,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[lead-capture] notify failed', { to, err })
      }),
    ),
  )
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(req: NextRequest, context: Params) {
  const { id } = await context.params

  // 1. Load source
  const sourceSnap = await adminDb.collection(LEAD_CAPTURE_SOURCES).doc(id).get()
  if (!sourceSnap.exists) return jsonError('Capture source not found', 404)
  const source = { id: sourceSnap.id, ...sourceSnap.data() } as CaptureSource
  if (source.deleted) return jsonError('Capture source has been removed', 404)
  if (!source.active) return jsonError('Capture source is not active', 403)

  // 2. Parse body
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError('Invalid JSON body', 400)

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!isEmail(email)) return jsonError('A valid email is required', 400)

  // ---- Spam protection gates ----
  const ip = clientIp(req)
  const honeypotEnabled = source.honeypotEnabled !== false // default ON

  // 2a. Honeypot — silently accept (look like a real success to fool bots).
  if (honeypotEnabled) {
    const rawHp =
      (body.data && typeof body.data === 'object' && (body.data as Record<string, unknown>)._hp) ??
      (body as Record<string, unknown>)._hp
    if (typeof rawHp === 'string' && rawHp.trim() !== '') {
      // eslint-disable-next-line no-console
      console.warn('[lead-capture] honeypot triggered', {
        sourceId: source.id,
        ip,
        email,
      })
      recordBlock(source.id, 'honeypot').catch(() => {})
      return jsonSuccess({
        ok: true,
        requiresConfirmation: source.doubleOptIn === 'on',
        message: source.successMessage,
      })
    }
  }

  // 2b. Rate-limit by IP (per hour).
  const rl = resolveRateLimit(source)
  if (rl.enabled) {
    const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000))
    const ipKey = `${source.id}_${sanitiseKeyPart(ip)}_${hourBucket}`
    const ipAllowed = await checkAndIncrement(ipKey, rl.maxPerHourPerIp, 2 * 60 * 60 * 1000, {
      kind: 'ip',
      sourceId: source.id,
      ip: sanitiseKeyPart(ip),
      hourBucket,
    })
    if (!ipAllowed) {
      recordBlock(source.id, 'rateLimit').catch(() => {})
      return NextResponse.json(
        { ok: false, error: 'Too many submissions. Try again later.' },
        { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': '3600' } },
      )
    }

    // 2c. Rate-limit by email (per day).
    const dayBucket = Math.floor(Date.now() / (24 * 60 * 60 * 1000))
    const emailKey = `${source.id}_${sanitiseKeyPart(email)}_${dayBucket}`
    const emailAllowed = await checkAndIncrement(
      emailKey,
      rl.maxPerDayPerEmail,
      48 * 60 * 60 * 1000,
      {
        kind: 'email',
        sourceId: source.id,
        email,
        dayBucket,
      },
    )
    if (!emailAllowed) {
      recordBlock(source.id, 'rateLimit').catch(() => {})
      return NextResponse.json(
        { ok: false, error: 'Too many submissions. Try again later.' },
        { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': '3600' } },
      )
    }
  }

  // 2d. Disposable email blocklist.
  if (source.blockDisposableEmails !== false && isDisposableEmail(email)) {
    recordBlock(source.id, 'disposable').catch(() => {})
    return NextResponse.json(
      { ok: false, error: 'Disposable email addresses are not allowed.' },
      { status: 422, headers: CORS_HEADERS },
    )
  }

  // 2e. Turnstile CAPTCHA — optional and only active when fully configured.
  // Required config: source.turnstileEnabled, per-source site key, and the
  // server-side TURNSTILE_SECRET_KEY. Missing config leaves Turnstile off so
  // half-configured sources do not block legitimate submissions.
  if (turnstileConfigured(source)) {
    const token =
      (typeof body.turnstileToken === 'string' && body.turnstileToken) ||
      (typeof body['cf-turnstile-response'] === 'string' &&
        (body['cf-turnstile-response'] as string)) ||
      ''
    const verification = await verifyTurnstileToken(token, ip)
    if (!verification.success) {
      recordBlock(source.id, 'captcha').catch(() => {})
      return NextResponse.json(
        { ok: false, error: 'CAPTCHA verification failed. Please try again.' },
        { status: 422, headers: CORS_HEADERS },
      )
    }
  }

  // Build the submitted data record from declared fields + any extras
  const rawData = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>
  const data: Record<string, string> = {}

  for (const field of source.fields ?? []) {
    const raw = rawData[field.key]
    const val = typeof raw === 'string' ? raw.trim() : ''
    if (field.required && !val) {
      return jsonError(`Field "${field.label}" is required`, 400)
    }
    if (val) data[field.key] = val
  }
  // Also accept top-level firstName/lastName/name/phone/company if not in fields
  for (const k of ['firstName', 'lastName', 'name', 'phone', 'company']) {
    if (!(k in data) && typeof rawData[k] === 'string' && (rawData[k] as string).trim()) {
      data[k] = (rawData[k] as string).trim()
    }
  }

  // US-097: capture UTM attribution from body/query for the created contact.
  const utm = extractUtm(req, body as Record<string, unknown>)
  const utmFields = utmContactFields(utm)

  // 3. Find or create contact
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingSnap = await (adminDb.collection('contacts') as any)
    .where('orgId', '==', source.orgId)
    .where('email', '==', email)
    .limit(1)
    .get()

  const incomingTags = source.tagsToApply ?? []
  const fullName =
    data.name ||
    [data.firstName, data.lastName].filter(Boolean).join(' ') ||
    email

  let contactId: string

  if (!existingSnap.empty) {
    const existingDoc = existingSnap.docs[0]
    contactId = existingDoc.id
    const existingData = existingDoc.data() as {
      tags?: string[]
      name?: string
      phone?: string
      company?: string
    } & Record<string, unknown>
    const mergedTags = Array.from(new Set([...(existingData.tags ?? []), ...incomingTags]))
    const patch: Record<string, unknown> = {
      tags: mergedTags,
      lastContactedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    // Don't overwrite name on dedup, but fill blanks
    if (!existingData.name && fullName) patch.name = fullName
    if (!existingData.phone && data.phone) patch.phone = data.phone
    if (!existingData.company && data.company) patch.company = data.company
    // US-097: only fill UTM attribution that the contact doesn't already have,
    // so first-touch attribution is preserved.
    for (const [field, value] of Object.entries(utmFields)) {
      if (!existingData[field] && value) patch[field] = value
    }
    await existingDoc.ref.update(patch)
  } else {
    const contactRef = await adminDb.collection('contacts').add({
      orgId: source.orgId,
      capturedFromId: source.id,
      name: fullName,
      email,
      phone: data.phone ?? '',
      company: data.company ?? '',
      website: '',
      source: 'form',
      type: 'lead',
      stage: 'new',
      tags: Array.from(new Set(incomingTags)),
      notes: '',
      assignedTo: '',
      deleted: false,
      subscribedAt: FieldValue.serverTimestamp(),
      unsubscribedAt: null,
      bouncedAt: null,
      // US-097: persist UTM attribution onto the new contact (undefined stripped).
      ...utmFields,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastContactedAt: FieldValue.serverTimestamp(),
    })
    contactId = contactRef.id
  }

  // 4. Create the submission
  const ipAddress = ip
  const userAgent = req.headers.get('user-agent') ?? ''
  const referer =
    (typeof body.referer === 'string' && body.referer) ||
    req.headers.get('referer') ||
    ''

  const submissionRef = adminDb.collection(LEAD_CAPTURE_SUBMISSIONS).doc()
  const submissionId = submissionRef.id
  const confirmationToken = signConfirmToken(submissionId)
  const doiOn = source.doubleOptIn === 'on'

  await submissionRef.set({
    orgId: source.orgId,
    captureSourceId: source.id,
    email,
    data,
    contactId,
    confirmedAt: doiOn ? null : FieldValue.serverTimestamp(),
    confirmationToken,
    ipAddress,
    userAgent,
    referer,
    createdAt: FieldValue.serverTimestamp(),
  })

  const submission: CaptureSubmission = {
    id: submissionId,
    orgId: source.orgId,
    captureSourceId: source.id,
    email,
    data,
    contactId,
    confirmedAt: doiOn ? null : (Timestamp.now() as unknown as CaptureSubmission['confirmedAt']),
    confirmationToken,
    ipAddress,
    userAgent,
    referer,
    createdAt: Timestamp.now() as unknown as CaptureSubmission['createdAt'],
  }

  const orgName = await getOrgName(source.orgId)

  // 5. DOI flow
  if (doiOn) {
    const confirmUrl = `${appUrl()}/lead/confirm/${encodeURIComponent(confirmationToken)}`
    try {
      const resolved = await resolveFrom({ orgName, fromLocal: 'hello' })
      const subject =
        source.confirmationSubject?.trim() ||
        `Please confirm your subscription to ${source.name}`
      const bodyHtmlTemplate =
        source.confirmationBodyHtml?.trim() ||
        defaultConfirmHtml({ confirmUrl, orgName, sourceName: source.name })
      const html = bodyHtmlTemplate.replace(/\{\{confirmUrl\}\}/g, confirmUrl)
      const text = htmlToPlainText(html)

      const result = await sendCampaignEmail({
        from: resolved.from,
        to: email,
        subject,
        html,
        text,
      })

      if (!result.ok) {
        // eslint-disable-next-line no-console
        console.error('[lead-capture] DOI send failed', result.error)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[lead-capture] DOI send threw', err)
    }

    // Fire-and-forget notify
    sendAdminNotifications({ source, submission, orgName }).catch(() => {})

    // US-091: fire outbound webhook async — never block the submit response.
    deliverCaptureWebhook({ source, submission, utm, requiresConfirmation: true }).catch(() => {})

    return jsonSuccess({
      ok: true,
      requiresConfirmation: true,
      message: source.successMessage,
      contactId,
      submissionId,
    })
  }

  // 6. Immediate enrollment + notify
  try {
    await performAutoEnroll(submission, source)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[lead-capture] auto-enroll failed', err)
  }

  sendAdminNotifications({ source, submission, orgName }).catch(() => {})

  // US-091: fire outbound webhook async — never block the submit response.
  deliverCaptureWebhook({ source, submission, utm, requiresConfirmation: false }).catch(() => {})

  return jsonSuccess({
    ok: true,
    requiresConfirmation: false,
    message: source.successMessage,
    redirect: source.successRedirectUrl || undefined,
    contactId,
    submissionId,
  })
}
