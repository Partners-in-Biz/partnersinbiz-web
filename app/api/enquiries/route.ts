import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { FROM_ADDRESS } from '@/lib/email/resend'
import { sendEmail } from '@/lib/email/send'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { fireTrigger } from '@/lib/automations/trigger'
import { enforcePublicRateLimit, publicRequestIp, publicRateLimitHash } from '@/lib/api/public-rate-limit'
import { getPartnerOpportunity } from '@/lib/partner-opportunities'
import { getOrgManagerEmails } from '@/lib/organizations/manager-emails'

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

const VALID_PROJECT_TYPES = ['web', 'mobile', 'design', 'marketing', 'seo', 'branding', 'partnership', 'other'] as const

function safeString(value: unknown, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeInterest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const type = safeString(input.type, 80)
  if (type !== 'partner-opportunity') return null

  const opportunityId = safeString(input.opportunityId, 120)
  const opportunityTitle = safeString(input.opportunityTitle, 200)
  if (!opportunityId || !opportunityTitle) return null

  return {
    type,
    opportunityId,
    opportunityTitle,
    notes: safeString(input.notes, 2000),
    consent: input.consent === true,
    source: safeString(input.source, 300),
    links: safeString(input.links, 1000),
    accessHandoff: safeString(input.accessHandoff, 80),
    requestedArea: safeString(input.requestedArea, 200),
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function deliveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'Email delivery failed')
  return message.replace(/\s+/g, ' ').trim().slice(0, 300) || 'Email delivery failed'
}

function emailSubjectText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
}

async function deliverEmail(input: { to: string; subject: string; html: string }) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      sendEmail({ ...input, from: FROM_ADDRESS }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Email delivery timed out')), 10_000)
      }),
    ])
    return result.success
      ? { status: 'sent' as const, attempts: 1, error: null }
      : { status: 'failed' as const, attempts: 1, error: deliveryError(result.error) }
  } catch (error) {
    return { status: 'failed' as const, attempts: 1, error: deliveryError(error) }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function POST(request: NextRequest) {
  // PUBLIC: website project enquiry form.
  const body = await request.json()
  const { name, email, company, projectType, details, userId, phone, website } = body
  const ip = publicRequestIp(request)
  const ipLimited = await enforcePublicRateLimit(request, {
    key: `enquiry_submit:${ip}`,
    limit: 10,
    windowMs: 60 * 60 * 1000,
  })
  if (ipLimited) return ipLimited

  if (typeof email === 'string' && email.trim()) {
    const emailLimited = await enforcePublicRateLimit(request, {
      key: `enquiry_email:${publicRateLimitHash(email.trim().toLowerCase())}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    })
    if (emailLimited) return emailLimited
  }

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  if (!isValidEmail(email)) return NextResponse.json({ error: 'Email is invalid' }, { status: 400 })
  if (!details?.trim()) return NextResponse.json({ error: 'Project details are required' }, { status: 400 })
  if (!projectType?.trim()) return NextResponse.json({ error: 'Project type is required' }, { status: 400 })
  if (!VALID_PROJECT_TYPES.includes(projectType)) return NextResponse.json({ error: 'Invalid project type' }, { status: 400 })

  const normalizedName = name.trim()
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedCompany = company?.trim() ?? ''
  const normalizedDetails = details.trim()
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : ''
  const normalizedWebsite = typeof website === 'string' ? website.trim() : ''
  const normalizedInterest = normalizeInterest(body.interest)

  if (projectType === 'partnership') {
    if (!normalizedInterest) {
      return NextResponse.json(
        { error: 'A valid partner opportunity selection is required' },
        { status: 400 }
      )
    }

    if (!normalizedInterest.consent) {
      return NextResponse.json(
        { error: 'Consent is required before registering interest in a partner opportunity' },
        { status: 400 }
      )
    }

    const opportunity = getPartnerOpportunity(normalizedInterest.opportunityId)
    if (!opportunity) {
      return NextResponse.json(
        { error: 'Selected partner opportunity is not available' },
        { status: 400 }
      )
    }
    normalizedInterest.opportunityTitle = opportunity.title

    if (opportunity.claimPrompt && !normalizedInterest.requestedArea) {
      return NextResponse.json(
        { error: 'Please specify the area you want to claim' },
        { status: 400 }
      )
    }
  }

  const docRef = await adminDb.collection('enquiries').add({
    userId: userId ?? null,
    name: normalizedName,
    email: normalizedEmail,
    company: normalizedCompany,
    phone: normalizedPhone,
    website: normalizedWebsite,
    projectType: projectType,
    details: normalizedDetails,
    interest: normalizedInterest,
    status: 'new',
    createdAt: FieldValue.serverTimestamp(),
    assignedTo: null,
    notificationDelivery: {
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    },
  })

  // Also create a CRM contact for this lead — scoped to the PIB platform org
  // (PIB-internal enquiries land in the platform-owner org's CRM).
  const areaSlug = normalizedInterest?.requestedArea
    ? normalizedInterest.requestedArea.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
    : ''
  const contactTags = normalizedInterest
    ? [
        'enquiry',
        'partner-opportunity',
        `opportunity:${normalizedInterest.opportunityId}`,
        ...(areaSlug ? [`area:${areaSlug}`] : []),
      ]
    : ['enquiry']
  const contactNotes = normalizedInterest
    ? `Enquiry ID: ${docRef.id}\nOpportunity: ${normalizedInterest.opportunityTitle} (${normalizedInterest.opportunityId})${normalizedInterest.requestedArea ? `\nRequested area: ${normalizedInterest.requestedArea}` : ''}\nSource: ${normalizedInterest.source || 'Not provided'}\nAccess handoff: ${normalizedInterest.accessHandoff || 'Not provided'}`
    : `Enquiry ID: ${docRef.id}`

  // Find-or-create: same orgId + email reuses the existing contact (matches
  // the public-capture dedupe behaviour) so repeat submitters don't duplicate.
  const existingSnap = await adminDb.collection('contacts')
    .where('orgId', '==', PIB_PLATFORM_ORG_ID)
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get()

  if (!existingSnap.empty) {
    const existingDoc = existingSnap.docs[0]
    const existing = existingDoc.data() as { tags?: string[]; notes?: string; name?: string; phone?: string; company?: string; website?: string }
    const mergedTags = Array.from(new Set([...(existing.tags ?? []), ...contactTags]))
    await existingDoc.ref.update({
      tags: mergedTags,
      notes: existing.notes ? `${existing.notes}\n\n${contactNotes}` : contactNotes,
      name: existing.name || normalizedName,
      phone: existing.phone || normalizedPhone,
      company: existing.company || normalizedCompany,
      website: existing.website || normalizedWebsite,
      updatedAt: FieldValue.serverTimestamp(),
    })
  } else {
    const contactRef = await adminDb.collection('contacts').add({
      orgId: PIB_PLATFORM_ORG_ID,
      capturedFromId: '',
      name: normalizedName,
      email: normalizedEmail,
      company: normalizedCompany,
      phone: normalizedPhone,
      website: normalizedWebsite,
      source: 'form',
      type: 'lead',
      stage: 'new',
      tags: contactTags,
      notes: contactNotes,
      assignedTo: '',
      deleted: false,
      subscribedAt: FieldValue.serverTimestamp(),
      unsubscribedAt: null,
      bouncedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastContactedAt: null,
    })

    await fireTrigger('contact.created', {
      orgId: PIB_PLATFORM_ORG_ID,
      contactId: contactRef.id,
      contactEmail: normalizedEmail,
    })
  }

  // Deliver the internal alert and submitter acknowledgement independently.
  // Direct Resend calls return `{ error }` for provider rejections, so awaiting
  // them without checking the result can silently lose the notification.
  try {
    const configuredManagers = Array.from(new Set(
      (await getOrgManagerEmails(PIB_PLATFORM_ORG_ID).catch(() => []))
        .filter((recipient): recipient is string => typeof recipient === 'string')
        .map((recipient) => recipient.trim().toLowerCase())
        .filter(isValidEmail),
    ))
    const configuredFallback = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
    const fallbackRecipient = isValidEmail(configuredFallback)
      ? configuredFallback
      : 'peet.stander@partnersinbiz.online'
    const adminRecipients = configuredManagers.length > 0 ? configuredManagers : [fallbackRecipient]
    const adminHtml = `
        <h2>New Project Inquiry</h2>
        <p><strong>Name:</strong> ${escapeHtml(normalizedName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(normalizedEmail)}</p>
        <p><strong>Company:</strong> ${escapeHtml(normalizedCompany || 'Not provided')}</p>
        <p><strong>Phone:</strong> ${escapeHtml(normalizedPhone || 'Not provided')}</p>
        <p><strong>Website / online link:</strong> ${escapeHtml(normalizedWebsite || 'Not provided')}</p>
        <p><strong>Project Type:</strong> ${escapeHtml(projectType)}</p>
        <p><strong>Details:</strong></p>
        <p>${escapeHtml(normalizedDetails).replace(/\n/g, '<br />')}</p>
        <p><em>Enquiry ID: ${docRef.id}</em></p>
      `
    const adminDeliveryPromise = Promise.all(adminRecipients.map(async (recipient) => ({
      recipient,
      ...await deliverEmail({
        to: recipient,
        subject: `New Project Inquiry from ${emailSubjectText(normalizedName)}`,
        html: adminHtml,
      }),
    })))
    const acknowledgementPromise = deliverEmail({
      to: normalizedEmail,
      subject: 'We received your Partners in Biz request',
      html: `
        <p>Hi ${escapeHtml(normalizedName)},</p>
        <p>Thank you for reaching out to Partners in Biz. We received your request and will review your website, search visibility, and social presence before replying.</p>
        <p>You can expect a practical response within one business day with the first fixes we would make.</p>
        <p>Regards,<br />Partners in Biz</p>
      `,
    })
    const [adminResults, acknowledgement] = await Promise.all([
      adminDeliveryPromise,
      acknowledgementPromise,
    ])
    const adminSent = adminResults.filter((result) => result.status === 'sent').length
    const adminStatus = adminSent === adminResults.length
      ? 'sent'
      : adminSent > 0
        ? 'partial'
        : 'failed'
    const anySent = adminSent > 0 || acknowledgement.status === 'sent'
    const allSent = adminStatus === 'sent' && acknowledgement.status === 'sent'

    await docRef.set({
      notificationDelivery: {
        status: allSent ? 'sent' : anySent ? 'partial' : 'failed',
        admin: {
          status: adminStatus,
          recipients: adminRecipients,
          attempts: adminResults.reduce((total, result) => total + result.attempts, 0),
          error: adminResults.find((result) => result.error)?.error ?? null,
          deliveries: adminResults,
        },
        acknowledgement: {
          ...acknowledgement,
          recipient: normalizedEmail,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
    }, { merge: true })
  } catch (err) {
    // The enquiry itself remains valid; preserve it and log a diagnostic rather
    // than returning a false submission failure to the prospect.
    console.error('[enquiries] notification delivery recording failed:', err)
  }

  return NextResponse.json({ id: docRef.id }, { status: 201 })
}
