import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { getResendClient, FROM_ADDRESS } from '@/lib/email/resend'
import type { AthleetSubmission } from '@/lib/onboarding/types'
import { enforcePublicRateLimit, publicRequestIp, publicRateLimitHash } from '@/lib/api/public-rate-limit'

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

const ALLOWED_PRODUCTS = ['athleet-management']

export async function POST(request: NextRequest) {
  // PUBLIC: Athleet onboarding/order intake form.
  const body = await request.json() as Partial<AthleetSubmission>
  const ipLimited = await enforcePublicRateLimit(request, {
    key: `onboarding_submit:${publicRequestIp(request)}`,
    limit: 10,
    windowMs: 60 * 60 * 1000,
  })
  if (ipLimited) return ipLimited
  if (body.adminEmail?.trim()) {
    const emailLimited = await enforcePublicRateLimit(request, {
      key: `onboarding_email:${publicRateLimitHash(body.adminEmail.trim().toLowerCase())}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    })
    if (emailLimited) return emailLimited
  }

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!body.product || !ALLOWED_PRODUCTS.includes(body.product)) {
    return NextResponse.json({ error: 'Invalid product.' }, { status: 400 })
  }
  if (!body.clubName?.trim()) {
    return NextResponse.json({ error: 'Club name is required.' }, { status: 400 })
  }
  if (!body.contactEmail?.trim() || !isValidEmail(body.contactEmail)) {
    return NextResponse.json({ error: 'A valid contact email is required.' }, { status: 400 })
  }
  if (!body.adminName?.trim()) {
    return NextResponse.json({ error: 'Admin name is required.' }, { status: 400 })
  }
  if (!body.adminEmail?.trim() || !isValidEmail(body.adminEmail)) {
    return NextResponse.json({ error: 'A valid admin email is required.' }, { status: 400 })
  }

  // ── Save submission to Firestore ──────────────────────────────────────────
  const submissionRef = await adminDb.collection('onboarding_submissions').add({
    ...body,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  // ── Create / update CRM contact ───────────────────────────────────────────
  let contactId: string | null = null
  try {
    const contactRef = await adminDb.collection('contacts').add({
      name: body.adminName.trim(),
      email: body.adminEmail.trim().toLowerCase(),
      company: body.clubName.trim(),
      phone: body.adminPhone?.trim() ?? '',
      website: body.existingDomain ? `https://${body.existingDomain}` : '',
      source: 'onboarding-form',
      type: 'client',
      stage: 'onboarding',
      tags: [body.product, body.sport ?? ''].filter(Boolean),
      notes: `Onboarding submission ID: ${submissionRef.id} | Product: ${body.product} | Sport: ${body.sport ?? '—'}`,
      assignedTo: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastContactedAt: null,
    })
    contactId = contactRef.id
    // Back-link the submission to the contact
    await submissionRef.update({ contactId })
  } catch (err) {
    console.error('[onboarding] CRM contact creation failed:', err)
  }

  // ── Send notification email ───────────────────────────────────────────────
  const coaches = (body.coaches ?? []).map(c => `• ${escapeHtml(c.name)} — ${escapeHtml(c.title)}`).join('<br>')
  const programs = (body.programs ?? []).map(p => `• ${escapeHtml(p.name)}${p.ageRange ? ` (${p.ageRange})` : ''}`).join('<br>')
  const features = [
    body.enableRegistrations && 'Registrations',
    body.enablePayments && 'Payments',
    body.enableScheduling && 'Scheduling',
    body.enableAthleteRecords && 'Athlete Records',
    body.enableTournaments && 'Tournaments',
    body.enableParentPortal && 'Parent Portal',
    body.enableEmailNotifications && 'Email Notifications',
  ].filter(Boolean).join(', ')

  try {
    await getResendClient().emails.send({
      from: FROM_ADDRESS,
      to: 'peet@partnersinbiz.online',
      subject: `🏆 New Athleet Order — ${escapeHtml(body.clubName)} (${escapeHtml(body.adminEmail)})`,
      html: `
        <h2 style="font-family:sans-serif">New Athleet Management Order</h2>
        <p style="font-family:sans-serif;color:#555">Submission ID: <code>${submissionRef.id}</code>${contactId ? ` | Contact ID: <code>${contactId}</code>` : ''}</p>
        <hr/>
        <h3 style="font-family:sans-serif">Club Identity</h3>
        <p style="font-family:sans-serif"><b>Club Name:</b> ${escapeHtml(body.clubName)}<br/>
        <b>Short Name:</b> ${escapeHtml(body.shortName ?? '—')}<br/>
        <b>Sport:</b> ${escapeHtml(body.sport ?? '—')}<br/>
        <b>Tagline:</b> ${escapeHtml(body.tagline ?? '—')}<br/>
        <b>Location:</b> ${[body.city, body.state, body.country].filter((v): v is string => Boolean(v)).map(escapeHtml).join(', ')}</p>
        <h3 style="font-family:sans-serif">Brand</h3>
        <p style="font-family:sans-serif">
          Primary: <span style="background:${escapeHtml(body.primaryColor ?? '#fff')};padding:2px 12px">&nbsp;</span> ${escapeHtml(body.primaryColor ?? '—')}<br/>
          Secondary: <span style="background:${escapeHtml(body.secondaryColor ?? '#ccc')};padding:2px 12px">&nbsp;</span> ${escapeHtml(body.secondaryColor ?? '—')}<br/>
          Accent: <span style="background:${escapeHtml(body.accentColor ?? '#f00')};padding:2px 12px">&nbsp;</span> ${escapeHtml(body.accentColor ?? '—')}
        </p>
        <h3 style="font-family:sans-serif">Admin / Contact</h3>
        <p style="font-family:sans-serif"><b>Name:</b> ${escapeHtml(body.adminName)}<br/>
        <b>Email:</b> ${escapeHtml(body.adminEmail)}<br/>
        <b>Phone:</b> ${escapeHtml(body.adminPhone ?? '—')}<br/>
        <b>Contact Email:</b> ${escapeHtml(body.contactEmail)}<br/>
        <b>Timezone:</b> ${escapeHtml(body.timezone ?? '—')}<br/>
        <b>Currency:</b> ${escapeHtml(body.currency ?? '—')}</p>
        <h3 style="font-family:sans-serif">Domain</h3>
        <p style="font-family:sans-serif">${body.hasDomain
          ? `Custom domain: <b>${escapeHtml(body.existingDomain ?? '—')}</b>`
          : `Subdomain: <b>${escapeHtml(body.subdomainPreference ?? '—')}.athleet.space</b>`
        }</p>
        <h3 style="font-family:sans-serif">Coaches</h3>
        <p style="font-family:sans-serif">${coaches || '—'}</p>
        <h3 style="font-family:sans-serif">Programs</h3>
        <p style="font-family:sans-serif">${programs || '—'}</p>
        <h3 style="font-family:sans-serif">Features Enabled</h3>
        <p style="font-family:sans-serif">${escapeHtml(features || '—')}</p>
        <hr/>
        <p style="font-family:sans-serif;color:#999;font-size:12px">
          Run the athleet-provision skill with submission ID <code>${submissionRef.id}</code> to create the private repo and deploy.
        </p>
      `,
    })
  } catch (err) {
    console.error('[onboarding] notification email failed:', err)
    // Don't fail the request — submission is already saved
  }

  return NextResponse.json({ id: submissionRef.id, contactId }, { status: 201 })
}
