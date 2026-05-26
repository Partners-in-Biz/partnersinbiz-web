// lib/broadcasts/send.ts
//
// Single-contact send pipeline for a broadcast. Shared by:
//   • app/api/cron/broadcasts/route.ts   — chunked background processing
//   • app/api/v1/broadcasts/[id]/send-now (immediate=true) — synchronous send
//
// Responsibilities per contact:
//   1. Idempotency check — skip if an emails doc already exists with
//      (broadcastId, contactId).
//   2. Resolve the from address.
//   3. Build template vars (from contact) + unsubscribe URL.
//   4. Render content — either template document via renderEmail() or the
//      inline subject/bodyHtml/bodyText with interpolate().
//   5. Send via Resend (or stub-log when RESEND_API_KEY is unset).
//   6. Create an `emails` doc tagged with broadcastId+contactId.
//   7. Increment broadcast.stats.sent or .failed.

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { sendCampaignEmail, htmlToPlainText, plainTextToHtml } from '@/lib/email/resend'
import { resolveFrom, type ResolvedSender } from '@/lib/email/resolveFrom'
import { interpolate, varsFromContact, type TemplateVars } from '@/lib/email/template'
import { signUnsubscribeToken } from '@/lib/email/unsubscribeToken'
import { isSuppressed } from '@/lib/email/suppressions'
import { renderEmail } from '@/lib/email-builder/render'
import { hasAmpBlocks, renderAmpEmail } from '@/lib/email-builder/render-amp'
import type { EmailDocument } from '@/lib/email-builder/types'
import type { Contact } from '@/lib/crm/types'
import type { Broadcast } from './types'
import { pickVariantForSend, incrementVariantStat } from '@/lib/ab-testing/cronHelpers'
import { applyVariantOverrides } from '@/lib/ab-testing/apply'
import type { Variant } from '@/lib/ab-testing/types'
import { shouldSendToContact } from '@/lib/preferences/store'
import { isWithinFrequencyCap, logFrequencySkip } from '@/lib/email/frequency'
import { sendSmsToContact } from '@/lib/sms/send'

export interface BroadcastSendContext {
  broadcast: Broadcast
  orgName: string
  resolvedSender: ResolvedSender
  templateDoc: EmailDocument | null   // null when broadcast uses inline content
}

export interface ContactSendOutcome {
  contactId: string
  status: 'sent' | 'failed' | 'skipped'
  resendId?: string
  error?: string
}

const RESEND_KEY_SET = !!process.env.RESEND_API_KEY?.trim()

function buildUnsubscribeUrl(contactId: string, broadcastId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  const token = signUnsubscribeToken(contactId, broadcastId)
  return `${base}/u/${encodeURIComponent(token)}`
}

function buildPreferencesUrlForContact(contactId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(
    /\/$/,
    '',
  )
  const token = signUnsubscribeToken(contactId)
  return `${base}/preferences/${encodeURIComponent(token)}`
}

/**
 * Loads everything we need once for an entire broadcast run, so per-contact
 * work doesn't repeat lookups. Caller should construct this before iterating.
 */
export async function buildSendContext(broadcast: Broadcast): Promise<BroadcastSendContext> {
  let orgName = ''
  try {
    const orgSnap = await adminDb.collection('organizations').doc(broadcast.orgId).get()
    if (orgSnap.exists) orgName = (orgSnap.data() as { name?: string })?.name ?? ''
  } catch {
    // Non-fatal.
  }

  const resolvedSender = await resolveFrom({
    fromDomainId: broadcast.fromDomainId,
    fromName: broadcast.fromName,
    fromLocal: broadcast.fromLocal,
    orgName,
  })

  let templateDoc: EmailDocument | null = null
  if (broadcast.content?.templateId) {
    const tplSnap = await adminDb
      .collection('email_templates')
      .doc(broadcast.content.templateId)
      .get()
    if (tplSnap.exists) {
      const data = tplSnap.data() ?? {}
      // Templates store the EmailDocument under either `document` or `doc`.
      // Default to `document` (matches the email-builder convention).
      const doc = (data.document ?? data.doc ?? null) as EmailDocument | null
      if (doc && typeof doc === 'object') templateDoc = doc
    }
  }

  return { broadcast, orgName, resolvedSender, templateDoc }
}

/**
 * Returns the set of contactIds we've already created docs for under this
 * broadcast. Used as a cheap idempotency cache for a single cron tick.
 *
 * For very large broadcasts we still re-check per-contact to be safe (because
 * the cache may exceed Firestore IN limits) — but for typical sizes this
 * single query saves N round-trips.
 *
 * Pass `channel='sms'` to read from the `sms` collection instead of `emails`.
 * Defaults to `'email'` for backwards-compat with existing callers.
 */
export async function loadSentContactIds(
  broadcastId: string,
  channel: 'email' | 'sms' = 'email',
): Promise<Set<string>> {
  const out = new Set<string>()
  const collection = channel === 'sms' ? 'sms' : 'emails'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = await (adminDb.collection(collection) as any)
    .where('broadcastId', '==', broadcastId)
    .get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of snap.docs as any[]) {
    const cid = d.data()?.contactId
    if (typeof cid === 'string' && cid) out.add(cid)
  }
  return out
}

/**
 * Send to a single contact. Caller has typically pre-fetched the
 * already-sent set to skip duplicates without a per-contact query; if not,
 * pass `null` and we fall back to a one-off query.
 *
 * Pass `forcedVariant` to bypass the A/B picker and use a specific variant
 * (used by the broadcast_recipients drain — winner already chosen).
 */
export async function sendBroadcastToContact(
  ctx: BroadcastSendContext,
  contact: Contact,
  alreadySent: Set<string> | null,
  forcedVariant: Variant | null = null,
): Promise<ContactSendOutcome> {
  const { broadcast, resolvedSender, templateDoc, orgName } = ctx
  const contactId = contact.id
  const topicId = broadcast.topicId || 'newsletter'
  const channel: 'email' | 'sms' = broadcast.channel ?? 'email'

  // ── SMS broadcast path. ────────────────────────────────────────────────
  // SMS broadcasts use `content.bodyText` as the message body, ignore
  // subject/HTML/template/from-domain, and dispatch via sendSmsToContact —
  // which handles preferences, suppression, frequency cap, twilio send,
  // sms-doc write, broadcast.stats.sent rollup, and activity log itself.
  if (channel === 'sms') {
    // Per-broadcast SMS idempotency: have we already sent to this contact
    // under this broadcastId? Use the `sms` collection for the check.
    if (alreadySent && alreadySent.has(contactId)) {
      return { contactId, status: 'skipped' }
    }
    if (!alreadySent) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dupSnap = await (adminDb.collection('sms') as any)
        .where('broadcastId', '==', broadcast.id)
        .where('contactId', '==', contactId)
        .limit(1)
        .get()
      if (!dupSnap.empty) return { contactId, status: 'skipped' }
    }

    // Build interpolation vars (mirror email path so {{firstName}} etc work).
    const unsubscribeUrl = buildUnsubscribeUrl(contactId, broadcast.id)
    const preferencesUrl = buildPreferencesUrlForContact(contactId)
    const vars: TemplateVars = {
      ...varsFromContact(contact),
      orgName,
      unsubscribeUrl,
      preferencesUrl,
    }

    // A/B variant pick — body overrides apply via bodyText. Same defer
    // semantics as email broadcasts.
    let pickedVariant: Variant | null
    if (forcedVariant) {
      pickedVariant = forcedVariant
    } else {
      const pick = pickVariantForSend({
        contactId,
        subjectId: broadcast.id,
        ab: broadcast.ab ?? null,
      })
      if (pick.defer) return { contactId, status: 'skipped' }
      pickedVariant = pick.variant
    }

    const rawSmsBody = broadcast.content?.bodyText ?? ''
    const interpolated = interpolate(rawSmsBody, vars)
    const effective = applyVariantOverrides(
      { subject: '', bodyHtml: '', bodyText: interpolated, fromName: '', scheduledFor: null },
      pickedVariant,
    )

    const outcome = await sendSmsToContact({
      orgId: broadcast.orgId,
      contactId,
      body: effective.bodyText,
      topicId,
      broadcastId: broadcast.id,
      variantId: pickedVariant?.id ?? '',
    })

    if (outcome.status === 'sent' && pickedVariant?.id) {
      try {
        await incrementVariantStat({
          targetCollection: 'broadcasts',
          targetId: broadcast.id,
          variantId: pickedVariant.id,
          field: 'sent',
        })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[broadcasts] sms variant stat increment failed', err)
      }
    }

    if (alreadySent && outcome.status !== 'skipped') alreadySent.add(contactId)

    if (outcome.status === 'sent') {
      return { contactId, status: 'sent', resendId: outcome.twilioSid }
    }
    if (outcome.status === 'failed') {
      return { contactId, status: 'failed', error: outcome.reason }
    }
    return { contactId, status: 'skipped' }
  }

  // ── Email path (default). ──────────────────────────────────────────────

  // Per-contact idempotency check.
  if (alreadySent && alreadySent.has(contactId)) {
    return { contactId, status: 'skipped' }
  }
  if (!alreadySent) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dupSnap = await (adminDb.collection('emails') as any)
      .where('broadcastId', '==', broadcast.id)
      .where('contactId', '==', contactId)
      .limit(1)
      .get()
    if (!dupSnap.empty) return { contactId, status: 'skipped' }
  }

  // Suppression check — even if audience filter missed this address (e.g.
  // suppression added between resolve and send), refuse here. Belt-and-braces.
  if (await isSuppressed(broadcast.orgId, contact.email)) {
    return { contactId, status: 'skipped' }
  }

  // Preferences gate — the SINGLE SOURCE OF TRUTH for "can I send to this
  // contact". Honours per-topic opt-outs, frequency='none', hard unsubscribes.
  const prefsCheck = await shouldSendToContact({ contactId, orgId: broadcast.orgId, topicId })
  if (!prefsCheck.allowed) {
    return { contactId, status: 'skipped' }
  }

  // Frequency cap — N emails per rolling 24h/7d, configured per-org.
  const freqCheck = await isWithinFrequencyCap(broadcast.orgId, contactId, topicId)
  if (!freqCheck.allowed) {
    await logFrequencySkip({
      orgId: broadcast.orgId,
      contactId,
      topicId,
      source: 'broadcast',
      sourceId: broadcast.id,
      reason: freqCheck.reason ?? 'frequency cap',
    })
    return { contactId, status: 'skipped' }
  }

  // Build vars + unsubscribe + preferences URL.
  const unsubscribeUrl = buildUnsubscribeUrl(contactId, broadcast.id)
  const preferencesUrl = buildPreferencesUrlForContact(contactId)
  const vars: TemplateVars = {
    ...varsFromContact(contact),
    orgName,
    unsubscribeUrl,
    preferencesUrl,
  }

  // Render — either via template document or inline interpolation.
  let subject = ''
  let html = ''
  let text = ''
  let ampFallbackMeta: Record<string, unknown> | null = null
  if (templateDoc) {
    // Build recipientContext for conditional blocks. customFields isn't on
    // the base Contact type today; we read it loosely if present (set by
    // CSV import / form-capture flows that store extras).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customFieldsRaw = (contact as any).customFields
    const customFields: Record<string, string> =
      customFieldsRaw && typeof customFieldsRaw === 'object' ? customFieldsRaw : {}
    const recipientContext = {
      tags: Array.isArray(contact.tags) ? contact.tags : [],
      stage: typeof contact.stage === 'string' ? contact.stage : '',
      customFields,
    }
    const rendered = renderEmail(templateDoc, vars, recipientContext)
    const ampRendered = renderAmpEmail(templateDoc, vars, recipientContext)
    subject = interpolate(templateDoc.subject ?? broadcast.content.subject ?? '', vars)
    html = rendered.html
    text = rendered.text

    // AMP-for-Email send-pipeline decision (documented + tested): the builder
    // can render AMP bodies, but our current provider abstraction and Resend
    // SDK adapter only send html/text parts. Until we move to a raw MIME send
    // path (or a provider API with explicit AMP MIME support), AMP blocks are
    // intentionally delivered through their safe HTML fallback from renderEmail.
    // Keep an audit marker on the email doc so support can explain why an AMP
    // template arrived as non-interactive HTML.
    if (hasAmpBlocks(templateDoc)) {
      ampFallbackMeta = {
        requested: true,
        rendered: !!ampRendered?.amp,
        sent: false,
        reason: 'send-provider-no-amp-mime-support',
        fallback: 'html',
      }
    }
  } else {
    subject = interpolate(broadcast.content.subject ?? '', vars)
    const rawHtml = broadcast.content.bodyHtml ?? ''
    const rawText = broadcast.content.bodyText ?? ''
    html = rawHtml ? interpolate(rawHtml, vars) : plainTextToHtml(interpolate(rawText, vars))
    text = rawText ? interpolate(rawText, vars) : htmlToPlainText(html)
  }

  // A/B variant selection — pick the variant for this contact, apply overrides.
  // If A/B is disabled or no variant assigned, this is a no-op.
  //
  // When `forcedVariant` is supplied (broadcast_recipients drain path), we
  // skip the picker entirely and use the supplied variant. This is how the
  // winner-only drain sends the chosen winner to deferred contacts.
  let pickedVariant: Variant | null
  if (forcedVariant) {
    pickedVariant = forcedVariant
  } else {
    const pick = pickVariantForSend({
      contactId,
      subjectId: broadcast.id,
      ab: broadcast.ab ?? null,
    })
    if (pick.defer) {
      // Winner-only test cohort excludes this contact; the cron will queue them
      // for the winner variant once it's decided. Skip for now.
      return { contactId, status: 'skipped' }
    }
    pickedVariant = pick.variant
  }
  const effective = applyVariantOverrides(
    { subject, bodyHtml: html, bodyText: text, fromName: broadcast.fromName, scheduledFor: null },
    pickedVariant,
  )
  subject = effective.subject
  html = effective.bodyHtml
  text = effective.bodyText
  const effectiveSender =
    effective.fromName.trim() && effective.fromName.trim() !== (broadcast.fromName ?? '').trim()
      ? await resolveFrom({
          fromDomainId: broadcast.fromDomainId,
          fromName: effective.fromName,
          fromLocal: broadcast.fromLocal,
          orgName,
        })
      : resolvedSender

  // Send (or stub when no key in env).
  let resendId = ''
  let sendProvider: 'resend' | 'ses' | '' = ''
  let sendOk = true
  let sendError: string | undefined
  if (RESEND_KEY_SET) {
    const result = await sendCampaignEmail({
      from: effectiveSender.from,
      to: contact.email,
      replyTo: broadcast.replyTo || undefined,
      subject,
      html,
      text,
      listUnsubscribeUrl: unsubscribeUrl,
    })
    sendOk = result.ok
    resendId = result.resendId
    sendProvider = result.provider
    sendError = result.error
  } else {
    // Dev / preview without Resend — log and pretend success so the rest of
    // the pipeline (stats, emails docs, idempotency) still flows.
    // eslint-disable-next-line no-console
    console.warn(
      `[broadcasts] RESEND_API_KEY not set — skipping actual send to ${contact.email} for broadcast ${broadcast.id}`,
    )
    resendId = `dryrun_${broadcast.id}_${contactId}`
  }

  // Persist the emails doc no matter what — failed sends are useful audit
  // trail and let webhooks roll up `failed` later.
  await adminDb.collection('emails').add({
    orgId: broadcast.orgId,
    campaignId: '',
    broadcastId: broadcast.id,
    fromDomainId: effectiveSender.fromDomainId,
    direction: 'outbound',
    contactId,
    resendId,
    provider: sendProvider,
    providerMessageId: resendId,
    from: effectiveSender.from,
    to: contact.email,
    cc: [],
    subject,
    bodyHtml: html,
    bodyText: text,
    status: sendOk ? 'sent' : 'failed',
    amp: ampFallbackMeta,
    scheduledFor: null,
    sentAt: sendOk ? FieldValue.serverTimestamp() : null,
    openedAt: null,
    clickedAt: null,
    bouncedAt: null,
    sequenceId: '',
    sequenceStep: null,
    variantId: pickedVariant?.id ?? '',
    topicId,
    createdAt: FieldValue.serverTimestamp(),
    deleted: false,
  })

  // Roll up the variant-level "sent" stat (best-effort).
  if (sendOk && pickedVariant?.id) {
    try {
      await incrementVariantStat({
        targetCollection: 'broadcasts',
        targetId: broadcast.id,
        variantId: pickedVariant.id,
        field: 'sent',
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[broadcasts] variant stat increment failed', err)
    }
  }

  // Roll up onto the broadcast stats.
  const statField = sendOk ? 'stats.sent' : 'stats.failed'
  await adminDb
    .collection('broadcasts')
    .doc(broadcast.id)
    .update({
      [statField]: FieldValue.increment(1),
      'stats.queued': FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    })

  // Log an activity row for the contact's timeline.
  if (sendOk) {
    try {
      await adminDb.collection('activities').add({
        orgId: broadcast.orgId,
        contactId,
        dealId: '',
        type: 'email_sent',
        summary: `Broadcast sent: ${subject}`,
        metadata: { broadcastId: broadcast.id, to: contact.email },
        createdBy: 'cron',
        createdAt: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      // Activity logging is best-effort.
      // eslint-disable-next-line no-console
      console.error('[broadcasts] activity log failed', err)
    }
  }

  if (alreadySent) alreadySent.add(contactId)

  return sendOk
    ? { contactId, status: 'sent', resendId }
    : { contactId, status: 'failed', error: sendError }
}

/**
 * Sibling of `sendBroadcastToContact` that uses a pre-picked A/B variant
 * instead of running the variant picker. Used by the broadcast_recipients
 * drain (winner-only mode) — the winner has already been chosen and every
 * deferred contact must receive it.
 *
 * Rationale (Option B per the spec): we don't want to change the picker's
 * behaviour for the regular send path, and forwarding through the same
 * core function via an optional `forcedVariant` parameter keeps the
 * logic in lockstep without duplicating the render/persist code.
 */
export async function sendBroadcastToContactWithVariant(
  ctx: BroadcastSendContext,
  contact: Contact,
  variant: Variant,
  alreadySent: Set<string> | null = null,
): Promise<ContactSendOutcome> {
  return sendBroadcastToContact(ctx, contact, alreadySent, variant)
}

/**
 * Convenience timestamp helper — exported so the cron + send-now can stamp
 * sendStartedAt / sendCompletedAt consistently.
 */
export function nowTs(): Timestamp {
  return Timestamp.now()
}
