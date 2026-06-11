import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { getResendClient, FROM_ADDRESS } from '@/lib/email/resend'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import { fireTrigger } from '@/lib/automations/trigger'
import { enforcePublicRateLimit, publicRequestIp, publicRateLimitHash } from '@/lib/api/public-rate-limit'
import { getPartnerOpportunity } from '@/lib/partner-opportunities'

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
  })

  // Also create a CRM contact for this lead — scoped to the PIB platform org
  // (PIB-internal enquiries land in the platform-owner org's CRM).
  const contactTags = normalizedInterest
    ? ['enquiry', 'partner-opportunity', `opportunity:${normalizedInterest.opportunityId}`]
    : ['enquiry']
  const contactNotes = normalizedInterest
    ? `Enquiry ID: ${docRef.id}\nOpportunity: ${normalizedInterest.opportunityTitle} (${normalizedInterest.opportunityId})\nSource: ${normalizedInterest.source || 'Not provided'}\nAccess handoff: ${normalizedInterest.accessHandoff || 'Not provided'}`
    : `Enquiry ID: ${docRef.id}`

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

  // Notification email — fire-and-forget; failure must not break form submission
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'peet.stander@partnersinbiz.online'
    const resend = getResendClient()
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: adminEmail,
      subject: `New Project Inquiry from ${escapeHtml(normalizedName)}`,
      html: `
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
      `,
    })

    await resend.emails.send({
      from: FROM_ADDRESS,
      to: normalizedEmail,
      subject: 'We received your Partners in Biz request',
      html: `
        <p>Hi ${escapeHtml(normalizedName)},</p>
        <p>Thank you for reaching out to Partners in Biz. We received your request and will review your website, search visibility, and social presence before replying.</p>
        <p>You can expect a practical response within one business day with the first fixes we would make.</p>
        <p>Regards,<br />Partners in Biz</p>
      `,
    })
  } catch (err) {
    // Log but do not fail the request
    console.error('[enquiries] notification email failed:', err)
  }

  return NextResponse.json({ id: docRef.id }, { status: 201 })
}
