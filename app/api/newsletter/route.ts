import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { getResendClient, sendCampaignEmail, FROM_ADDRESS } from '@/lib/email/resend'
import { checkFormRateLimit } from '@/lib/forms/ratelimit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]?.trim() || 'unknown'
  return req.headers.get('x-real-ip') || 'unknown'
}

async function readEmail(req: NextRequest): Promise<{ email: string; source: string | null }> {
  const ct = req.headers.get('content-type') ?? ''
  let email = ''
  let source: string | null = null
  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({}))
    email = String(body?.email ?? '')
    source = body?.source ? String(body.source) : null
  } else {
    const form = await req.formData()
    email = String(form.get('email') ?? '')
    source = form.get('source') ? String(form.get('source')) : null
  }
  return { email: email.trim().toLowerCase(), source }
}

function htmlResponse(): string {
  const accent = '#F5A623'
  const bg = '#0A0A0B'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Subscribed — Partners in Biz</title>
<meta name="robots" content="noindex" />
<style>
  html,body{margin:0;padding:0;background:${bg};color:#EDEDED;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;min-height:100vh}
  .wrap{max-width:520px;margin:0 auto;padding:120px 24px 60px;text-align:center}
  h1{font-family:'Instrument Serif',Georgia,serif;font-size:48px;line-height:1;margin:0 0 16px;font-weight:400}
  em{color:${accent};font-style:normal}
  p{font-size:16px;line-height:1.5;color:#9a9a9a;margin:0 0 32px}
  a{display:inline-block;padding:12px 20px;border:1px solid #2a2a2a;color:#EDEDED;text-decoration:none;border-radius:999px;font-size:14px}
  a:hover{border-color:${accent}}
</style>
</head>
<body>
  <div class="wrap">
    <h1>You&rsquo;re <em>in</em>.</h1>
    <p>Thanks — you&rsquo;ll get the next dispatch when it ships. No fluff, no spam.</p>
    <a href="/">Back to the studio</a>
  </div>
</body>
</html>`
}

export async function POST(req: NextRequest) {
  try {
    // PUBLIC: newsletter signup form, rate-limited per IP.
    const ip = clientIp(req)
    const allowed = await checkFormRateLimit('newsletter', ip, 5)
    if (!allowed) {
      return NextResponse.json(
        { ok: false, error: 'Too many requests' },
        { status: 429 },
      )
    }

    const { email, source } = await readEmail(req)
    const wantsJson = (req.headers.get('accept') ?? '').includes('application/json')
    const referer = req.headers.get('referer')
    const userAgent = req.headers.get('user-agent') ?? null

    if (!email || !EMAIL_RE.test(email)) {
      if (wantsJson) {
        return NextResponse.json({ ok: false, error: 'Invalid email' }, { status: 400 })
      }
      return NextResponse.redirect(new URL(referer || '/', req.url), { status: 303 })
    }

    const ref = adminDb.collection('newsletter_subscribers').doc(email)
    const existing = await ref.get()

    if (existing.exists) {
      await ref.update({ lastSeenAt: FieldValue.serverTimestamp() })
    } else {
      await ref.set({
        email,
        source: source || referer || 'footer',
        ip,
        userAgent,
        status: 'subscribed',
        createdAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
        resendContactId: null,
      })

      const audienceId = process.env.RESEND_AUDIENCE_ID
      if (audienceId && process.env.RESEND_API_KEY) {
        try {
          const resend = getResendClient()
          const result = await resend.contacts.create({
            email,
            audienceId,
            unsubscribed: false,
          })
          const contactId = result?.data?.id
          if (contactId) {
            await ref.update({ resendContactId: contactId })
          }
        } catch (err) {
          console.error('[newsletter] resend audience add failed:', err)
        }
      }

      const notifyText = [
        `${email} just subscribed.`,
        ``,
        `Source: ${source || referer || 'footer'}`,
        `IP: ${ip}`,
        `UA: ${userAgent || 'unknown'}`,
      ].join('\n')
      const notifyResult = await sendCampaignEmail({
        from: FROM_ADDRESS,
        to: FROM_ADDRESS,
        subject: 'New newsletter subscriber',
        text: notifyText,
        html: `<pre style="font-family:monospace;white-space:pre-wrap">${notifyText}</pre>`,
      })
      if (!notifyResult.ok) {
        console.error('[newsletter] notify failed:', notifyResult.error)
      }
    }

    if (wantsJson) {
      return NextResponse.json({ ok: true, alreadySubscribed: existing.exists })
    }
    return new NextResponse(htmlResponse(), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  } catch (err) {
    console.error('[newsletter] error:', err)
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 })
  }
}
