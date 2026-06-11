/**
 * POST /api/v1/forms/:slug/submit — PUBLIC: hosted form submission endpoint, no auth.
 *
 * Flow:
 *   1. Resolve form by (orgId + slug + active=true). orgId comes from ?orgId=
 *   2. Rate-limit per IP (form.rateLimitPerMinute / minute).
 *   3. Validate payload against form.fields (honeypot short-circuits to 200).
 *   4. Persist submission. If form.createContact && email present, upsert
 *      contact and link contactId.
 *   5. Fire notification emails to form.notifyEmails via Resend (swallow errors).
 *   6. Dispatch `form.submitted` webhook to outbound subscribers.
 *
 * Response body:
 *   { success: true, data: { submitted, thankYou, redirectUrl } }
 */
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { apiSuccess, apiError } from '@/lib/api/response'
import { validateSubmission } from '@/lib/forms/validate'
import { checkFormRateLimit } from '@/lib/forms/ratelimit'
import { verifyTurnstileToken } from '@/lib/forms/turnstile'
import { getResendClient, FROM_ADDRESS } from '@/lib/email/resend'
import type { Form } from '@/lib/forms/types'
import { dispatchWebhook } from '@/lib/webhooks/dispatch'
import { formSubmissionRef } from '@/lib/orgMembers/memberRef'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  // @ts-expect-error — NextRequest.ip exists at runtime on Vercel edge/node
  return (req.ip as string | undefined) ?? 'unknown'
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderNotificationHtml(
  form: Form,
  data: Record<string, unknown>,
): string {
  const rows = form.fields
    .map((field) => {
      const raw = data[field.id]
      const shown = Array.isArray(raw) ? raw.join(', ') : raw == null ? '' : String(raw)
      return `<tr><td style="padding:6px 12px;font-weight:600;vertical-align:top;">${escapeHtml(
        field.label,
      )}</td><td style="padding:6px 12px;">${escapeHtml(shown)}</td></tr>`
    })
    .join('')
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111;">
    <h2 style="margin:0 0 12px;">New submission: ${escapeHtml(form.name)}</h2>
    <table style="border-collapse:collapse;">${rows}</table>
  </div>`
}

async function upsertContactForSubmission(
  orgId: string,
  formId: string,
  formName: string,
  normalized: Record<string, unknown>,
): Promise<string | null> {
  const email = typeof normalized.email === 'string' ? normalized.email.trim().toLowerCase() : ''
  if (!email) return null

  const existing = await adminDb
    .collection('contacts')
    .where('orgId', '==', orgId)
    .where('email', '==', email)
    .limit(1)
    .get()

  const name =
    (typeof normalized.name === 'string' && normalized.name.trim()) ||
    [normalized.firstName, normalized.lastName]
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .join(' ')
      .trim() ||
    email

  const phone = typeof normalized.phone === 'string' ? normalized.phone.trim() : ''
  const company = typeof normalized.company === 'string' ? normalized.company.trim() : ''

  if (!existing.empty) {
    const doc = existing.docs[0]
    await doc.ref.update({
      updatedAt: FieldValue.serverTimestamp(),
      lastContactedAt: FieldValue.serverTimestamp(),
      ...(phone && !doc.data()?.phone ? { phone } : {}),
      ...(company && !doc.data()?.company ? { company } : {}),
    })
    return doc.id
  }

  const submitterRef = formSubmissionRef(formId, formName)
  const created = await adminDb.collection('contacts').add({
    orgId,
    name,
    email,
    phone,
    company,
    website: '',
    source: 'form',
    type: 'lead',
    stage: 'new',
    tags: [],
    notes: '',
    assignedTo: '',
    formId,
    createdBy: submitterRef.uid,
    createdByRef: submitterRef,
    updatedBy: submitterRef.uid,
    updatedByRef: submitterRef,
    deleted: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastContactedAt: FieldValue.serverTimestamp(),
  })
  return created.id
}

export async function POST(
  req: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { id: slug } = await context.params
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')
  if (!orgId) return apiError('orgId is required; pass it as ?orgId=', 400)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Request body must be valid JSON', 400)
  }

  // Locate form.
  const formsSnap = await adminDb
    .collection('forms')
    .where('orgId', '==', orgId)
    .where('slug', '==', slug)
    .where('active', '==', true)
    .limit(1)
    .get()
  if (formsSnap.empty) return apiError('Form not found', 404)
  const formDoc = formsSnap.docs[0]
  const form = { id: formDoc.id, ...(formDoc.data() as Omit<Form, 'id'>) } as Form
  if (form.deleted === true) return apiError('Form not found', 404)

  const ip = getClientIp(req)
  const userAgent = req.headers.get('user-agent') ?? 'unknown'

  // Rate limit.
  const allowed = await checkFormRateLimit(form.id, ip, form.rateLimitPerMinute)
  if (!allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many submissions. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  // Turnstile CAPTCHA — when enabled on the form, require a valid token.
  // The widget injects `cf-turnstile-response` into the submitted body.
  if (form.turnstileEnabled) {
    const token = typeof body['cf-turnstile-response'] === 'string'
      ? (body['cf-turnstile-response'] as string)
      : ''
    const verification = await verifyTurnstileToken(token, ip)
    if (!verification.success) {
      return apiError(
        `CAPTCHA verification failed${verification.errorCodes?.length ? ': ' + verification.errorCodes.join(', ') : ''}`,
        400,
      )
    }
  }

  // Validate.
  const result = validateSubmission(form, body)

  // Honeypot: silently accept without creating a submission.
  if (result.ok && 'normalized' in result && result._honeypot) {
    return apiSuccess({
      submitted: true,
      thankYou: form.thankYouMessage,
      redirectUrl: form.redirectUrl,
    })
  }

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.errors.join('; '), errors: result.errors },
      { status: 400 },
    )
  }

  const normalized = result.normalized
  const submitterRef = formSubmissionRef(form.id, form.name)

  // Persist submission.
  const submissionRef = await adminDb.collection('form_submissions').add({
    formId: form.id,
    orgId,
    data: normalized,
    submittedAt: FieldValue.serverTimestamp(),
    ipAddress: ip,
    userAgent,
    status: 'new' as const,
    contactId: null,
    source: 'form',
    createdBy: submitterRef.uid,
    createdByRef: submitterRef,
  })

  // Upsert contact if requested.
  let contactId: string | null = null
  if (form.createContact) {
    try {
      contactId = await upsertContactForSubmission(orgId, form.id, form.name, normalized)
      if (contactId) {
        await submissionRef.update({ contactId })
        // Write a CRM activity so this submission appears in the contact timeline.
        await adminDb.collection('activities').add({
          orgId,
          contactId,
          dealId: '',
          type: 'note',
          summary: `Submitted form: ${form.name}`,
          metadata: { formId: form.id, submissionId: submissionRef.id, formName: form.name },
          createdBy: submitterRef.uid,
          createdByRef: submitterRef,
          createdAt: FieldValue.serverTimestamp(),
        })
      }
    } catch {
      // Contact upsert / activity failures must never block a submission.
    }
  }

  // Notification emails (best-effort — swallow all errors).
  if (form.notifyEmails?.length) {
    try {
      const client = getResendClient()
      const html = renderNotificationHtml(form, normalized)
      await client.emails.send({
        from: FROM_ADDRESS,
        to: form.notifyEmails,
        subject: `New submission: ${form.name}`,
        html,
      })
    } catch {
      // Ignore — submission has already been written.
    }
  }

  try {
    await dispatchWebhook(orgId, 'form.submitted', {
      formId: form.id,
      slug: form.slug,
      submissionId: submissionRef.id,
      contactId,
      data: normalized,
    })
  } catch (err) {
    console.error('[webhook-dispatch-error] form.submitted', err)
  }

  return apiSuccess({
    submitted: true,
    thankYou: form.thankYouMessage,
    redirectUrl: form.redirectUrl,
  })
}
