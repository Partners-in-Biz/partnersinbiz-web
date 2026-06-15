import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { getResendClient, FROM_ADDRESS } from '@/lib/email/resend'
import { enforcePublicRateLimit, publicRequestIp, publicRateLimitHash } from '@/lib/api/public-rate-limit'
import { fulfillConfirmedBooking } from '@/lib/bookings/fulfillment'

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatDisplay(date: string, time: string) {
  const [y, mo, d] = date.split('-').map(Number)
  const displayDate = new Date(y, mo - 1, d).toLocaleDateString('en-ZA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  return { displayDate, displayTime: `${time} SAST` }
}

export async function POST(request: NextRequest) {
  // PUBLIC: website booking request form.
  const body = await request.json()
  const { name, email, date, time, company, brief } = body
  const ip = publicRequestIp(request)
  const ipLimited = await enforcePublicRateLimit(request, {
    key: `booking_submit:${ip}`,
    limit: 10,
    windowMs: 60 * 60 * 1000,
  })
  if (ipLimited) return ipLimited

  if (typeof email === 'string' && email.trim()) {
    const emailLimited = await enforcePublicRateLimit(request, {
      key: `booking_email:${publicRateLimitHash(email.trim().toLowerCase())}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    })
    if (emailLimited) return emailLimited
  }

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!email?.trim() || !isValidEmail(email)) return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Valid date is required' }, { status: 400 })
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: 'Valid time is required' }, { status: 400 })

  // Race-condition guard
  const existing = await adminDb.collection('bookings')
    .where('date', '==', date)
    .where('time', '==', time)
    .where('status', '==', 'confirmed')
    .limit(1)
    .get()
  if (!existing.empty) {
    return NextResponse.json({ error: 'This slot was just taken — please choose another.' }, { status: 409 })
  }

  const docRef = await adminDb.collection('bookings').add({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    company: company?.trim() ?? '',
    brief: brief?.trim() ?? '',
    date,
    time,
    durationMins: 20,
    timezone: 'Africa/Johannesburg',
    googleEventId: '',
    meetLink: '',
    status: 'confirmed',
    fulfillmentStatus: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  })

  const fulfillment = await fulfillConfirmedBooking({
    id: docRef.id,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    company: company?.trim() ?? '',
    brief: brief?.trim() ?? '',
    date,
    time,
    durationMins: 20,
    timezone: 'Africa/Johannesburg',
  }, { sendGoogleUpdates: 'all' })

  const googleEventId = fulfillment.googleEventId ?? ''
  const meetLink = fulfillment.meetLink ?? ''
  const calendarError = fulfillment.errors.find((error) => error.startsWith('google_calendar:'))?.replace(/^google_calendar:\s*/, '') ?? ''

  const { displayDate, displayTime } = formatDisplay(date, time)
  const adminEmail = process.env.ADMIN_EMAIL || 'peet.stander@partnersinbiz.online'

  // Admin notification
  try {
    await getResendClient().emails.send({
      from: FROM_ADDRESS,
      to: adminEmail,
      subject: `Call booked — ${esc(name)} on ${displayDate} at ${displayTime}`,
      html: `
        <h2>New 20-min Intro Call</h2>
        <p><strong>Name:</strong> ${esc(name)}</p>
        <p><strong>Email:</strong> ${esc(email)}</p>
        ${company ? `<p><strong>Company:</strong> ${esc(company)}</p>` : ''}
        <p><strong>Date:</strong> ${displayDate}</p>
        <p><strong>Time:</strong> ${displayTime}</p>
        ${brief ? `<p><strong>Brief:</strong> ${esc(brief)}</p>` : ''}
        <p><em>Booking ID: ${docRef.id}</em></p>
        ${googleEventId
          ? `<p>✓ Google Calendar event created${meetLink ? ` — <a href="${meetLink}">Join Meet</a>` : ''}</p>`
          : `<p>⚠ Google Calendar failed: <code>${esc(calendarError || 'GOOGLE_CALENDAR_ID not set')}</code></p>`}
      `,
    })
  } catch (err) {
    console.error('[bookings] admin notification failed:', err)
  }

  // Confirmation to booker
  try {
    await getResendClient().emails.send({
      from: FROM_ADDRESS,
      to: email.trim().toLowerCase(),
      subject: `Your call with Partners in Biz — ${displayDate} at ${displayTime}`,
      html: `
        <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111;max-width:560px">
          <h2 style="margin:0 0 16px">You're booked in!</h2>
          <p>Hi ${esc(name)},</p>
          <p>Your 20-minute intro call with Peet at Partners in Biz is confirmed:</p>
          <p style="background:#f5f5f5;padding:12px 16px;border-radius:6px">
            📅 <strong>${displayDate}</strong><br>
            🕐 <strong>${displayTime}</strong>${meetLink ? `<br>🎥 <a href="${meetLink}" style="color:#0066cc">${meetLink}</a>` : ''}
          </p>
          ${meetLink
            ? `<p><a href="${meetLink}" style="display:inline-block;background:#0066cc;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Join Google Meet</a></p>`
            : '<p>Peet will send you a Google Meet link shortly.</p>'}
          <p>Feel free to reply to this email with any background on your project in the meantime.</p>
          <p>See you soon,<br><strong>Peet @ Partners in Biz</strong></p>
        </div>
      `,
    })
  } catch (err) {
    console.error('[bookings] confirmation email failed:', err)
  }

  return NextResponse.json({ id: docRef.id }, { status: 201 })
}
