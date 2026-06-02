/**
 * POST /api/public/capture/[publicKey]
 *
 * Public, unauthenticated contact capture endpoint. Each org provisions one
 * or more CaptureSources; the source's `publicKey` is the only auth — rotating
 * the key kills any deployed widgets / integrations using it.
 *
 * Body (JSON):
 *   email      string (required)
 *   firstName? string
 *   lastName?  string
 *   name?      string  (used if first/last not provided)
 *   phone?     string
 *   company?   string
 *   notes?     string
 *   tags?      string[]  (merged with source.autoTags)
 *   meta?      Record<string, unknown>  (passed into the contact's notes/metadata)
 *   consent?   boolean   (required true when source.consentRequired)
 *   _hp?       string    (honeypot — bots fill this; we silently 200)
 *
 * Returns:
 *   201 { contactId }   on first capture
 *   200 { contactId, deduped: true } when an existing contact was found
 *   400 / 401 / 403 / 422 / 429 on errors
 *
 * Security:
 *   - Per-publicKey + per-IP rate limit (10/min) via the existing forms limiter
 *   - Honeypot field `_hp` silently no-ops on submit
 *   - CORS open to all origins (it's a public capture)
 *   - Source must be `enabled: true` and `deleted: false`
 *
 * Behavior on capture:
 *   - Auto-tags from the source merged with any tags in the body
 *   - Existing contact (same orgId + email) is reused, not duplicated
 *   - If source.autoCampaignIds includes any *active* campaigns, an enrollment
 *     is created for each (idempotent — skips already-enrolled). First-step
 *     `nextSendAt` honors the sequence's first-step delay.
 *   - If source.autoSequenceIds includes any *active* sequences, direct
 *     sequence enrollments are also created idempotently.
 *   - 'contact_captured' activity logged on first creation
 */
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { checkFormRateLimit } from '@/lib/forms/ratelimit'
import { checkQuota } from '@/lib/platform/quotas'
import type { CaptureSource } from '@/lib/crm/captureSources'
import type { Campaign } from '@/lib/campaigns/types'
import type { Sequence } from '@/lib/sequences/types'

type Params = { params: Promise<{ publicKey: string }> }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  const first = fwd.split(',')[0]?.trim()
  return first || req.headers.get('x-real-ip') || 'unknown'
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: CORS_HEADERS })
}

function jsonSuccess(data: Record<string, unknown>, status: number = 200): NextResponse {
  return NextResponse.json({ data }, { status, headers: CORS_HEADERS })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(req: NextRequest, context: Params) {
  const { publicKey } = await context.params

  // ── 1. Resolve the CaptureSource ───────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sourceSnap = await (adminDb.collection('capture_sources') as any)
    .where('publicKey', '==', publicKey)
    .limit(1)
    .get()

  if (sourceSnap.empty) {
    return jsonError('Invalid capture key', 401)
  }

  const sourceDoc = sourceSnap.docs[0]
  const source = { id: sourceDoc.id, ...sourceDoc.data() } as CaptureSource

  if (source.deleted) return jsonError('Capture source has been disabled', 403)
  if (!source.enabled) return jsonError('Capture source is not active', 403)

  // ── 2. Rate limit by publicKey + IP ────────────────────────────────────────
  const ip = clientIp(req)
  const allowed = await checkFormRateLimit(`capture_${publicKey}`, ip, 10)
  if (!allowed) {
    return jsonError('Too many submissions — try again in a moment', 429)
  }

  // ── 3. Parse + validate the body ───────────────────────────────────────────
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError('Invalid JSON body', 400)

  // Honeypot: silently 200 on submission so the bot thinks it succeeded.
  if (typeof body._hp === 'string' && body._hp.trim().length > 0) {
    return jsonSuccess({ ok: true, deduped: false }, 200)
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !isEmail(email)) return jsonError('A valid email is required', 400)

  if (source.consentRequired && body.consent !== true) {
    return jsonError('Consent is required for this form', 422)
  }

  // Compose contact fields
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : ''
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : ''
  const givenName = typeof body.name === 'string' ? body.name.trim() : ''
  const fullName = givenName || [firstName, lastName].filter(Boolean).join(' ') || email

  const userTags = Array.isArray(body.tags) ? body.tags.filter((t: unknown): t is string => typeof t === 'string') : []
  const tags = Array.from(new Set([...source.autoTags, ...userTags]))

  // Notes/metadata: stash arbitrary form metadata on the contact's notes
  // so operators can see what was submitted.
  let metaSummary = ''
  if (body.meta && typeof body.meta === 'object') {
    try {
      metaSummary = JSON.stringify(body.meta).slice(0, 1000)
    } catch {
      metaSummary = ''
    }
  }
  const notes = [
    typeof body.notes === 'string' ? body.notes.trim() : '',
    metaSummary ? `Submitted: ${metaSummary}` : '',
  ].filter(Boolean).join('\n\n')

  // ── 4. Find-or-create the Contact ──────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingSnap = await (adminDb.collection('contacts') as any)
    .where('orgId', '==', source.orgId)
    .where('email', '==', email)
    .limit(1)
    .get()

  let contactId: string
  let isNew = false

  if (!existingSnap.empty) {
    contactId = existingSnap.docs[0].id
    // Merge tags (de-duped) and bump lastContactedAt; do not overwrite name
    const existing = existingSnap.docs[0].data() as { tags?: string[] }
    const mergedTags = Array.from(new Set([...(existing.tags ?? []), ...tags]))
    await existingSnap.docs[0].ref.update({
      tags: mergedTags,
      lastContactedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  } else {
    isNew = true
    const docRef = await adminDb.collection('contacts').add({
      orgId: source.orgId,
      capturedFromId: source.id,
      name: fullName,
      email,
      phone: typeof body.phone === 'string' ? body.phone.trim() : '',
      company: typeof body.company === 'string' ? body.company.trim() : '',
      website: '',
      source: 'form',
      type: 'lead',
      stage: 'new',
      tags,
      notes,
      assignedTo: '',
      deleted: false,
      subscribedAt: FieldValue.serverTimestamp(),
      unsubscribedAt: null,
      bouncedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastContactedAt: FieldValue.serverTimestamp(),
    })
    contactId = docRef.id
  }

  // ── 5. Bump source counter (best-effort) ───────────────────────────────────
  try {
    await sourceDoc.ref.update({
      capturedCount: FieldValue.increment(1),
      lastCapturedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    console.error('[capture] failed to bump source counter', source.id, err)
  }

  // ── 6. Activity log on first capture ───────────────────────────────────────
  if (isNew) {
    try {
      await adminDb.collection('activities').add({
        orgId: source.orgId,
        contactId,
        type: 'note',
        summary: `Captured via "${source.name}"`,
        metadata: { sourceId: source.id, sourceType: source.type, ip },
        createdBy: 'capture',
        createdAt: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      console.error('[capture] activity log failed', err)
    }
  }

  // ── 7. Auto-enroll into matching active campaigns ──────────────────────────
  // Skip if the contact is unsubscribed/bounced/already-enrolled.
  for (const campaignId of source.autoCampaignIds ?? []) {
    try {
      const campSnap = await adminDb.collection('campaigns').doc(campaignId).get()
      if (!campSnap.exists) continue
      const campaign = campSnap.data() as Campaign
      if (campaign.deleted || campaign.status !== 'active') continue
      if (campaign.orgId !== source.orgId) continue

      // Idempotency
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = await (adminDb.collection('sequence_enrollments') as any)
        .where('campaignId', '==', campaignId)
        .where('contactId', '==', contactId)
        .limit(1)
        .get()
      if (!existing.empty) continue

      const seqSnap = await adminDb.collection('sequences').doc(campaign.sequenceId).get()
      if (!seqSnap.exists) continue
      const sequence = seqSnap.data() as Sequence
      if (!sequence.steps?.length) continue

      const firstStep = sequence.steps[0]
      const delayMs = (firstStep.delayDays ?? 0) * 24 * 60 * 60 * 1000
      const nextSendAt = Timestamp.fromDate(new Date(Date.now() + delayMs))

      await adminDb.collection('sequence_enrollments').add({
        orgId: source.orgId,
        campaignId,
        sequenceId: campaign.sequenceId,
        contactId,
        status: 'active',
        currentStep: 0,
        enrolledAt: FieldValue.serverTimestamp(),
        nextSendAt,
        deleted: false,
      })

      await campSnap.ref.update({
        'stats.enrolled': FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      })

      await adminDb.collection('activities').add({
        orgId: source.orgId,
        contactId,
        type: 'sequence_enrolled',
        summary: `Auto-enrolled in campaign: ${campaign.name}`,
        metadata: { campaignId, sequenceId: campaign.sequenceId, sourceId: source.id },
        createdBy: 'capture',
        createdAt: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      console.error('[capture] auto-enroll failed', { campaignId, contactId }, err)
    }
  }

  // ── 8. Auto-enroll directly into active sequences ─────────────────────────
  // Capture sources can route leads straight into nurture without requiring a
  // campaign wrapper. Existing sequence_enrollments use campaignId="" for this.
  for (const sequenceId of source.autoSequenceIds ?? []) {
    try {
      const seqSnap = await adminDb.collection('sequences').doc(sequenceId).get()
      if (!seqSnap.exists) continue
      const sequence = seqSnap.data() as Sequence
      if (sequence.deleted || sequence.status !== 'active') continue
      if (sequence.orgId !== source.orgId) continue
      if (!sequence.steps?.length) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = await (adminDb.collection('sequence_enrollments') as any)
        .where('sequenceId', '==', sequenceId)
        .where('contactId', '==', contactId)
        .limit(1)
        .get()
      if (!existing.empty) continue

      const firstStep = sequence.steps[0]
      const delayMs = (firstStep.delayDays ?? 0) * 24 * 60 * 60 * 1000
      const nextSendAt = Timestamp.fromDate(new Date(Date.now() + delayMs))

      await adminDb.collection('sequence_enrollments').add({
        orgId: source.orgId,
        campaignId: '',
        sequenceId,
        contactId,
        status: 'active',
        currentStep: 0,
        enrolledAt: FieldValue.serverTimestamp(),
        nextSendAt,
        deleted: false,
      })

      await adminDb.collection('activities').add({
        orgId: source.orgId,
        contactId,
        type: 'sequence_enrolled',
        summary: `Auto-enrolled in sequence: ${sequence.name}`,
        metadata: { sequenceId, sourceId: source.id },
        createdBy: 'capture',
        createdAt: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      console.error('[capture] direct sequence auto-enroll failed', { sequenceId, contactId }, err)
    }
  }

  // Fire-and-forget quota tracking — never blocks the response
  if (isNew) {
    checkQuota(source.orgId, 'contactsPerMonth').catch(() => {})
  }

  return jsonSuccess({ contactId, deduped: !isNew, redirectUrl: source.redirectUrl || undefined }, isNew ? 201 : 200)
}
