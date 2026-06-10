// app/api/preferences/[token]/route.ts
//
// Public POST handler for the preferences page. Verifies the HMAC token,
// upserts contact_preferences, then redirects back to the page with
// ?saved=1. Accepts either JSON or form-encoded bodies so the page works
// with or without JavaScript.

import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribeToken'
import {
  getOrgPreferencesConfig,
  setContactPreferences,
} from '@/lib/preferences/store'
import { FREQUENCY_CHOICES, type FrequencyChoice } from '@/lib/preferences/types'
import { enforcePublicRateLimit, publicRequestIp, publicRateLimitHash } from '@/lib/api/public-rate-limit'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ token: string }>
}

function redirect(token: string, params: Record<string, string>): NextResponse {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(
    /\/$/,
    '',
  )
  const qs = new URLSearchParams(params).toString()
  const target = `${base}/preferences/${encodeURIComponent(token)}${qs ? `?${qs}` : ''}`
  return NextResponse.redirect(target, { status: 303 })
}

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { token } = await context.params
  // PUBLIC: contact preferences save endpoint protected by signed unsubscribe token.
  const limited = await enforcePublicRateLimit(req, {
    key: `preferences:${publicRateLimitHash(token)}:${publicRequestIp(req)}`,
    limit: 20,
    windowMs: 60 * 60 * 1000,
  })
  if (limited) return limited

  const verified = verifyUnsubscribeToken(token)
  if (!verified.ok) return redirect(token, { error: 'invalid-token' })
  const contactId = verified.contactId

  // Parse body — JSON or form-encoded.
  const ct = req.headers.get('content-type') ?? ''
  let topics: Record<string, boolean> = {}
  let frequency: FrequencyChoice | undefined
  let unsubscribeAll = false

  try {
    if (ct.includes('application/json')) {
      const body = (await req.json()) as Record<string, unknown>
      if (body.topics && typeof body.topics === 'object') {
        for (const [k, v] of Object.entries(body.topics as Record<string, unknown>)) {
          topics[k] = v === true || v === 'true' || v === 'on'
        }
      }
      if (typeof body.frequency === 'string' && FREQUENCY_CHOICES.includes(body.frequency as FrequencyChoice)) {
        frequency = body.frequency as FrequencyChoice
      }
      if (body.unsubscribeAll === true || body.unsubscribeAll === 'true') {
        unsubscribeAll = true
      }
    } else {
      // form-encoded or multipart
      const form = await req.formData()
      // Collect topic_<id> checkboxes — load org config to know all known topic ids.
      const cSnap = await adminDb.collection('contacts').doc(contactId).get()
      if (!cSnap.exists) return redirect(token, { error: 'contact-not-found' })
      const cd = cSnap.data() ?? {}
      const orgId = typeof cd.orgId === 'string' ? cd.orgId : ''
      if (!orgId) return redirect(token, { error: 'contact-missing-org' })
      const cfg = await getOrgPreferencesConfig(orgId)

      for (const t of cfg.topics) {
        const key = `topic_${t.id}`
        // Forms omit unchecked checkboxes, so absence === false.
        // Transactional topic is always opted-in (UI disables the box) — force true.
        const val = form.get(key)
        topics[t.id] = t.id === 'transactional' ? true : val !== null
      }
      const f = form.get('frequency')
      if (typeof f === 'string' && FREQUENCY_CHOICES.includes(f as FrequencyChoice)) {
        frequency = f as FrequencyChoice
      }
      if (form.get('unsubscribeAll') === 'true' || form.get('unsubscribeAll') === 'on') {
        unsubscribeAll = true
      }
    }
  } catch {
    return redirect(token, { error: 'invalid-body' })
  }

  // We need the orgId even on the JSON path.
  let orgId: string
  try {
    const cSnap = await adminDb.collection('contacts').doc(contactId).get()
    if (!cSnap.exists) return redirect(token, { error: 'contact-not-found' })
    const cd = cSnap.data() ?? {}
    if (typeof cd.orgId !== 'string' || !cd.orgId) {
      return redirect(token, { error: 'contact-missing-org' })
    }
    orgId = cd.orgId
  } catch {
    return redirect(token, { error: 'lookup-failed' })
  }

  try {
    await setContactPreferences({
      contactId,
      orgId,
      topics,
      frequency,
      unsubscribeAll: frequency === 'none' ? true : unsubscribeAll,
      updatedFrom: 'preferences-page',
    })

    // If they unsubscribed from everything, also flip the legacy contact-doc
    // unsubscribedAt so the existing send pipelines (and the unsubscribe page
    // logic) treat them as fully unsubscribed.
    if (frequency === 'none' || unsubscribeAll) {
      await adminDb.collection('contacts').doc(contactId).update({
        unsubscribed: true,
        unsubscribedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[preferences] save failed', err)
    return redirect(token, { error: 'save-failed' })
  }

  return redirect(token, { saved: '1' })
}
