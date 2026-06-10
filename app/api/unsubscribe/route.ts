import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribeToken'
import { syncUnsubscribeToIntegrations } from '@/lib/crm/integrations/syncOptOut'
import { addSuppression } from '@/lib/email/suppressions'
import { enforcePublicRateLimit, publicRequestIp, publicRateLimitHash } from '@/lib/api/public-rate-limit'

type UnsubResult =
  | { ok: false; status: 400 | 404; heading: string; message: string }
  | {
      ok: true
      alreadyUnsubscribed: boolean
      campaignName?: string
      orgName?: string
    }

/**
 * Shared opt-out worker. Used by both GET (browser click) and POST (mail
 * client one-click per RFC 8058). Idempotent — calling twice for the same
 * contact is a no-op after the first time.
 */
async function performUnsubscribe(token: string | null): Promise<UnsubResult> {
  if (!token) {
    return { ok: false, status: 400, heading: 'Invalid link', message: 'No contact token was provided.' }
  }

  const verified = verifyUnsubscribeToken(token)
  if (!verified.ok) {
    return {
      ok: false,
      status: 400,
      heading: 'Invalid link',
      message: 'This unsubscribe link is invalid or has expired.',
    }
  }
  const contactId = verified.contactId
  const tokenCampaignId = verified.campaignId

  const docRef = adminDb.collection('contacts').doc(contactId)
  const doc = await docRef.get()

  if (!doc.exists) {
    return {
      ok: false,
      status: 404,
      heading: 'Invalid link',
      message: 'We could not find your contact record.',
    }
  }

  // Honor either the legacy boolean or the new timestamp signal as "already done"
  const data = doc.data() ?? {}
  const alreadyUnsubscribed = !!data.unsubscribed || !!data.unsubscribedAt
  if (alreadyUnsubscribed) {
    return { ok: true, alreadyUnsubscribed: true }
  }

  // 1. Mark the contact as unsubscribed
  await docRef.update({
    unsubscribed: true,
    unsubscribedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  // 2. Exit any active sequence enrollments for this contact and tally per-campaign hits
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enrollSnap = await (adminDb.collection('sequence_enrollments') as any)
    .where('contactId', '==', contactId)
    .where('status', '==', 'active')
    .get()

  const campaignHits = new Map<string, number>()
  for (const eDoc of enrollSnap.docs) {
    const enrollment = eDoc.data() as { campaignId?: string }
    await eDoc.ref.update({
      status: 'exited',
      exitReason: 'unsubscribed',
      updatedAt: FieldValue.serverTimestamp(),
    })
    const cid = enrollment.campaignId ?? ''
    if (cid) campaignHits.set(cid, (campaignHits.get(cid) ?? 0) + 1)
  }

  // 3. Bump campaign.stats.unsubscribed for each affected campaign
  for (const [campaignId, hits] of campaignHits.entries()) {
    try {
      await adminDb.collection('campaigns').doc(campaignId).update({
        'stats.unsubscribed': FieldValue.increment(hits),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      console.error('[unsubscribe] failed to bump campaign stats', campaignId, err)
    }
  }

  // 4. Propagate opt-out to CRM integrations (non-blocking)
  const orgId = (data.orgId as string | undefined) ?? ''
  if (orgId) {
    syncUnsubscribeToIntegrations(contactId, orgId).catch((err) =>
      console.error('[unsubscribe] opt-out sync failed', err)
    )
  }

  // 5. Add a permanent suppression so future sends from this org never reach
  //    this address — covers cases where the contact record gets re-imported
  //    or the email is sent ad-hoc via the send API.
  const contactEmail = typeof data.email === 'string' ? data.email : ''
  if (orgId && contactEmail) {
    try {
      await addSuppression({
        orgId,
        email: contactEmail,
        reason: 'manual-unsub',
        source: 'api',
        scope: 'permanent',
        expiresAt: null,
        details: { campaignId: tokenCampaignId || undefined },
        createdBy: 'system',
      })
    } catch (err) {
      console.error('[unsubscribe] failed to add suppression', orgId, contactEmail, err)
    }
  }

  // 6. Resolve campaign/org names for campaign-aware confirmation page
  let campaignName: string | undefined
  let orgName: string | undefined

  if (tokenCampaignId) {
    try {
      const campSnap = await adminDb.collection('campaigns').doc(tokenCampaignId).get()
      if (campSnap.exists) {
        const campData = campSnap.data() as { name?: string; orgId?: string }
        campaignName = campData.name || undefined
        const campaignOrgId = campData.orgId
        if (campaignOrgId) {
          const orgSnap = await adminDb.collection('organizations').doc(campaignOrgId).get()
          if (orgSnap.exists) {
            orgName = (orgSnap.data() as { name?: string })?.name || undefined
          }
        }
      }
    } catch (err) {
      // Non-fatal — fall back to generic copy
      console.error('[unsubscribe] failed to resolve campaign/org for page', tokenCampaignId, err)
    }
  }

  return { ok: true, alreadyUnsubscribed: false, campaignName, orgName }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  // PUBLIC: one-click/browser unsubscribe endpoint protected by signed token.
  const limited = await enforcePublicRateLimit(req, {
    key: `unsubscribe_ip:${publicRequestIp(req)}`,
    limit: 120,
    windowMs: 60 * 60 * 1000,
  })
  if (limited) return new NextResponse(unsubscribePage('Too many requests', 'Please try again later.'), {
    status: 429,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
  if (token) {
    const tokenLimited = await enforcePublicRateLimit(req, {
      key: `unsubscribe:${publicRateLimitHash(token)}`,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    })
    if (tokenLimited) return new NextResponse(unsubscribePage('Too many requests', 'Please try again later.'), {
      status: 429,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const result = await performUnsubscribe(token)

  if (!result.ok) {
    return new NextResponse(unsubscribePage(result.heading, result.message), {
      status: result.status,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  if (result.alreadyUnsubscribed) {
    return new NextResponse(
      unsubscribePage('Already unsubscribed', 'You are already unsubscribed from our emails.'),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  const confirmMessage = result.campaignName && result.orgName
    ? `You have been successfully removed from ${result.campaignName} by ${result.orgName}. You will no longer receive emails from this campaign.`
    : result.campaignName
      ? `You have been successfully removed from ${result.campaignName}. You will no longer receive emails from this campaign.`
      : 'You have been successfully removed from our email list. You will no longer receive marketing emails from us.'

  return new NextResponse(
    unsubscribePage('You\'ve been unsubscribed', confirmMessage),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

/**
 * POST handler — required for RFC 8058 one-click unsubscribe. Mail clients
 * (Gmail, Yahoo, Apple Mail) POST to the List-Unsubscribe URL when the user
 * hits the inline "Unsubscribe" button. They send
 * `application/x-www-form-urlencoded` with body `List-Unsubscribe=One-Click`.
 *
 * We accept the token from EITHER the query string (matching the GET URL
 * shape we already send) OR from form data, and return 200 on success.
 */
export async function POST(req: NextRequest) {
  // Token can arrive via query string (?token=...) — our links already have
  // it there — or in the request body as form data.
  let token = req.nextUrl.searchParams.get('token')
  const limited = await enforcePublicRateLimit(req, {
    key: `unsubscribe_ip:${publicRequestIp(req)}`,
    limit: 120,
    windowMs: 60 * 60 * 1000,
  })
  if (limited) return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 })

  if (!token) {
    const contentType = req.headers.get('content-type') ?? ''
    try {
      if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
        const form = await req.formData()
        const t = form.get('token')
        if (typeof t === 'string') token = t
      } else if (contentType.includes('application/json')) {
        const body = await req.json().catch(() => ({}))
        if (typeof body?.token === 'string') token = body.token
      }
    } catch {
      // Best-effort body parse — fall through with token=null.
    }
  }

  if (token) {
    const tokenLimited = await enforcePublicRateLimit(req, {
      key: `unsubscribe:${publicRateLimitHash(token)}`,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    })
    if (tokenLimited) return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 })
  }

  const result = await performUnsubscribe(token)

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.message }, { status: result.status })
  }

  return NextResponse.json({ success: true })
}

function unsubscribePage(heading: string, message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${heading} — Partners in Biz</title>
</head>
<body style="margin:0;padding:0;background:#111;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:480px;margin:80px auto;padding:0 24px;text-align:center;">
    <div style="margin-bottom:32px;">
      <span style="color:#F59E0B;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Partners in Biz</span>
    </div>
    <div style="background:#1A1A1A;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:32px 24px;">
      <h1 style="color:#FAFAFA;font-size:18px;font-weight:600;margin:0 0 12px 0;">${heading}</h1>
      <p style="color:rgba(255,255,255,0.5);font-size:14px;line-height:1.6;margin:0;">${message}</p>
    </div>
    <p style="color:rgba(255,255,255,0.2);font-size:12px;margin-top:24px;">partnersinbiz.online</p>
  </div>
</body>
</html>`
}
