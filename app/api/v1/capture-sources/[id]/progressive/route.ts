// app/api/v1/capture-sources/[id]/progressive/route.ts
//
// PUBLIC endpoint — no auth.
//
// Drives the multi-step / progressive-profiling flow for a capture source.
// Body: { submissionId?: string, email: string, step: number, data?: object,
//         turnstileToken?: string, referer?: string }
//
// Flow:
//   1. If `submissionId` is omitted, this is step 1. We validate the email,
//      pass the same spam-protection gates as /submit (honeypot + rate-limit
//      + disposable email), create-or-update the contact, and write a fresh
//      submission with `currentStep = 0` and `completedSteps = false`. The
//      submission carries no `confirmedAt` yet (auto-enroll is deferred to
//      the final step). We return `submissionId` + `nextStep`.
//   2. If `submissionId` is provided, we load the existing submission,
//      append the incoming `data` to it, and increment `currentStep`. If
//      the supplied `step` is the last configured step, we mark the
//      submission complete, run the same DOI vs. immediate-enroll logic as
//      /submit, and return the final status.
//
// This lets a multi-step widget capture the email on step 1 even if the user
// bails on step 2 — partial submits still write to Firestore and still create
// the contact, so they will still receive any auto-enrolled emails (once
// confirmed, if DOI is on).

import { NextRequest, NextResponse } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { sendCampaignEmail, htmlToPlainText } from '@/lib/email/resend'
import { resolveFrom } from '@/lib/email/resolveFrom'
import { signConfirmToken } from '@/lib/lead-capture/token'
import { performAutoEnroll } from '@/lib/lead-capture/autoEnroll'
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
  if (!s || typeof s !== 'string') return false
  if (s.length > 254) return false
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return false
  const local = s.split('@')[0]
  if (/^[a-z]{1,3}\d{6,}$/i.test(local)) return false
  return true
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
    return true
  }
}

async function recordBlock(sourceId: string, reason: BlockReason): Promise<void> {
  try {
    await adminDb.collection(LEAD_CAPTURE_SOURCES).doc(sourceId).update({
      [`stats.blocked.${reason}`]: FieldValue.increment(1),
    })
  } catch {
    // best-effort
  }
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
      sendCampaignEmail({ from: resolved.from, to, subject, html, text }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[lead-capture] progressive notify failed', { to, err })
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

  const steps = source.display?.steps ?? []
  const totalSteps = steps.length
  if (!source.display || source.display.mode !== 'multi-step' || totalSteps === 0) {
    return jsonError('This source is not configured for progressive submission', 400)
  }

  // 2. Parse body
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError('Invalid JSON body', 400)

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!isEmail(email)) return jsonError('A valid email is required', 400)

  const stepIndex = typeof body.step === 'number' ? Math.floor(body.step) : 0
  if (stepIndex < 0 || stepIndex >= totalSteps) {
    return jsonError(`step must be between 0 and ${totalSteps - 1}`, 400)
  }
  const isLastStep = stepIndex >= totalSteps - 1
  const providedSubmissionId =
    typeof body.submissionId === 'string' && body.submissionId.trim()
      ? body.submissionId.trim()
      : ''

  const ip = clientIp(req)
  const userAgent = req.headers.get('user-agent') ?? ''
  const referer =
    (typeof body.referer === 'string' && body.referer) ||
    req.headers.get('referer') ||
    ''

  // Honeypot — only checked on step 0 (no point gating later steps which
  // require an existing submissionId from a real client).
  const rawData =
    body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {}

  if (!providedSubmissionId) {
    const honeypotEnabled = source.honeypotEnabled !== false
    if (honeypotEnabled) {
      const rawHp = rawData._hp ?? (body as Record<string, unknown>)._hp
      if (typeof rawHp === 'string' && rawHp.trim() !== '') {
        // eslint-disable-next-line no-console
        console.warn('[lead-capture] progressive honeypot triggered', {
          sourceId: source.id,
          ip,
          email,
        })
        recordBlock(source.id, 'honeypot').catch(() => {})
        // Pretend we accepted — return a fake submissionId so the bot follows the flow.
        return jsonSuccess({
          ok: true,
          submissionId: `hp_${Date.now()}`,
          nextStep: stepIndex + 1,
          isLast: false,
        })
      }
    }

    // Rate limit
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
      const dayBucket = Math.floor(Date.now() / (24 * 60 * 60 * 1000))
      const emailKey = `${source.id}_${sanitiseKeyPart(email)}_${dayBucket}`
      const emailAllowed = await checkAndIncrement(
        emailKey,
        rl.maxPerDayPerEmail,
        48 * 60 * 60 * 1000,
        { kind: 'email', sourceId: source.id, email, dayBucket },
      )
      if (!emailAllowed) {
        recordBlock(source.id, 'rateLimit').catch(() => {})
        return NextResponse.json(
          { ok: false, error: 'Too many submissions. Try again later.' },
          { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': '3600' } },
        )
      }
    }

    // Disposable email block
    if (source.blockDisposableEmails !== false && isDisposableEmail(email)) {
      recordBlock(source.id, 'disposable').catch(() => {})
      return NextResponse.json(
        { ok: false, error: 'Disposable email addresses are not allowed.' },
        { status: 422, headers: CORS_HEADERS },
      )
    }
  }

  // Final-step Turnstile check (only if Turnstile is fully configured)
  if (isLastStep && turnstileConfigured(source)) {
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

  // Sanitise incoming step data — strip honeypot, drop empty strings.
  const stepData: Record<string, string> = {}
  Object.entries(rawData).forEach(([k, raw]) => {
    if (k === '_hp') return
    if (typeof raw !== 'string') return
    const val = raw.trim()
    if (!val) return
    stepData[k] = val
  })
  // Top-level common keys
  for (const k of ['firstName', 'lastName', 'name', 'phone', 'company']) {
    if (!(k in stepData) && typeof rawData[k] === 'string' && (rawData[k] as string).trim()) {
      stepData[k] = (rawData[k] as string).trim()
    }
  }

  // ─── Branch: step 1 (no submissionId yet) ────────────────────────────────
  if (!providedSubmissionId) {
    // Find or create the contact (same logic as /submit)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingSnap = await (adminDb.collection('contacts') as any)
      .where('orgId', '==', source.orgId)
      .where('email', '==', email)
      .limit(1)
      .get()

    const incomingTags = source.tagsToApply ?? []
    const fullName =
      stepData.name ||
      [stepData.firstName, stepData.lastName].filter(Boolean).join(' ') ||
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
      }
      const mergedTags = Array.from(new Set([...(existingData.tags ?? []), ...incomingTags]))
      const patch: Record<string, unknown> = {
        tags: mergedTags,
        lastContactedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (!existingData.name && fullName) patch.name = fullName
      if (!existingData.phone && stepData.phone) patch.phone = stepData.phone
      if (!existingData.company && stepData.company) patch.company = stepData.company
      await existingDoc.ref.update(patch)
    } else {
      const contactRef = await adminDb.collection('contacts').add({
        orgId: source.orgId,
        capturedFromId: source.id,
        name: fullName,
        email,
        phone: stepData.phone ?? '',
        company: stepData.company ?? '',
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
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastContactedAt: FieldValue.serverTimestamp(),
      })
      contactId = contactRef.id
    }

    // Create the partial submission
    const submissionRef = adminDb.collection(LEAD_CAPTURE_SUBMISSIONS).doc()
    const submissionId = submissionRef.id
    const confirmationToken = signConfirmToken(submissionId)

    await submissionRef.set({
      orgId: source.orgId,
      captureSourceId: source.id,
      email,
      data: stepData,
      contactId,
      // Defer DOI confirm until completion. We still record DOI requirement
      // server-side and only fire the email + auto-enroll on the final step.
      confirmedAt: null,
      confirmationToken,
      ipAddress: ip,
      userAgent,
      referer,
      currentStep: stepIndex,
      completedSteps: false,
      createdAt: FieldValue.serverTimestamp(),
    })

    return jsonSuccess({
      ok: true,
      submissionId,
      nextStep: stepIndex + 1,
      isLast: false,
    })
  }

  // ─── Branch: subsequent step (existing submissionId) ─────────────────────
  const subRef = adminDb.collection(LEAD_CAPTURE_SUBMISSIONS).doc(providedSubmissionId)
  const subSnap = await subRef.get()
  if (!subSnap.exists) return jsonError('Submission not found', 404)
  const existing = subSnap.data() as CaptureSubmission | undefined
  if (!existing) return jsonError('Submission not found', 404)
  if (existing.captureSourceId !== source.id) {
    return jsonError('Submission does not belong to this source', 400)
  }
  if (existing.email !== email) {
    return jsonError('Email mismatch on progressive step', 400)
  }
  if (existing.completedSteps) {
    // Already finalized — return success idempotently
    return jsonSuccess({
      ok: true,
      submissionId: providedSubmissionId,
      nextStep: totalSteps,
      isLast: true,
      requiresConfirmation: source.doubleOptIn === 'on' && !existing.confirmedAt,
      message: source.successMessage,
      redirect: source.successRedirectUrl || undefined,
      contactId: existing.contactId,
    })
  }

  // Merge in this step's data (overwrite on key collision — last step wins).
  const mergedData: Record<string, string> = { ...(existing.data || {}), ...stepData }
  const update: Record<string, unknown> = {
    data: mergedData,
    currentStep: stepIndex,
    updatedAt: FieldValue.serverTimestamp(),
  }

  // Also fill blanks on the contact from this step's data
  try {
    const contactRef = adminDb.collection('contacts').doc(existing.contactId)
    const contactSnap = await contactRef.get()
    if (contactSnap.exists) {
      const contactData = contactSnap.data() as {
        name?: string
        phone?: string
        company?: string
      }
      const contactPatch: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
        lastContactedAt: FieldValue.serverTimestamp(),
      }
      const newName =
        mergedData.name ||
        [mergedData.firstName, mergedData.lastName].filter(Boolean).join(' ') ||
        ''
      if (!contactData.name && newName) contactPatch.name = newName
      if (!contactData.phone && mergedData.phone) contactPatch.phone = mergedData.phone
      if (!contactData.company && mergedData.company) contactPatch.company = mergedData.company
      if (Object.keys(contactPatch).length > 2) {
        await contactRef.update(contactPatch)
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[lead-capture] progressive contact patch failed', err)
  }

  if (!isLastStep) {
    await subRef.update(update)
    return jsonSuccess({
      ok: true,
      submissionId: providedSubmissionId,
      nextStep: stepIndex + 1,
      isLast: false,
    })
  }

  // ─── Final step — run DOI or immediate auto-enroll ───────────────────────
  const doiOn = source.doubleOptIn === 'on'
  update.completedSteps = true
  if (!doiOn) update.confirmedAt = FieldValue.serverTimestamp()
  await subRef.update(update)

  // Rebuild the in-memory submission object for downstream helpers
  const finalSubmission: CaptureSubmission = {
    id: providedSubmissionId,
    orgId: source.orgId,
    captureSourceId: source.id,
    email,
    data: mergedData,
    contactId: existing.contactId,
    confirmedAt: doiOn
      ? null
      : (Timestamp.now() as unknown as CaptureSubmission['confirmedAt']),
    confirmationToken: existing.confirmationToken,
    ipAddress: existing.ipAddress || ip,
    userAgent: existing.userAgent || userAgent,
    referer: existing.referer || referer,
    createdAt: existing.createdAt,
    currentStep: stepIndex,
    completedSteps: true,
  }

  const orgName = await getOrgName(source.orgId)

  if (doiOn) {
    const confirmUrl = `${appUrl()}/lead/confirm/${encodeURIComponent(finalSubmission.confirmationToken)}`
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
        console.error('[lead-capture] progressive DOI send failed', result.error)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[lead-capture] progressive DOI send threw', err)
    }

    sendAdminNotifications({ source, submission: finalSubmission, orgName }).catch(() => {})

    return jsonSuccess({
      ok: true,
      submissionId: providedSubmissionId,
      nextStep: totalSteps,
      isLast: true,
      requiresConfirmation: true,
      message: source.successMessage,
      contactId: existing.contactId,
    })
  }

  // Immediate enrollment + notify
  try {
    await performAutoEnroll(finalSubmission, source)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[lead-capture] progressive auto-enroll failed', err)
  }
  sendAdminNotifications({ source, submission: finalSubmission, orgName }).catch(() => {})

  return jsonSuccess({
    ok: true,
    submissionId: providedSubmissionId,
    nextStep: totalSteps,
    isLast: true,
    requiresConfirmation: false,
    message: source.successMessage,
    redirect: source.successRedirectUrl || undefined,
    contactId: existing.contactId,
  })
}
