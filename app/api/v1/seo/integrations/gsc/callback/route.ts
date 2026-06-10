import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { exchangeGscCode } from '@/lib/seo/integrations/gsc'
import { FieldValue } from 'firebase-admin/firestore'
import { encryptCredentials } from '@/lib/integrations/crypto'

export const dynamic = 'force-dynamic'

function timestampToMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const timestamp = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
  if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime()
  const seconds = timestamp.seconds ?? timestamp._seconds
  return typeof seconds === 'number' ? seconds * 1000 : null
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url)
  const code = u.searchParams.get('code')
  const state = u.searchParams.get('state')
  if (!code || !state) return NextResponse.json({ success: false, error: 'missing code/state' }, { status: 400 })
  let parsed: { sprintId?: string; uid?: string }
  try {
    parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8'))
  } catch {
    return NextResponse.json({ success: false, error: 'bad state' }, { status: 400 })
  }
  if (!parsed.sprintId) return NextResponse.json({ success: false, error: 'no sprintId' }, { status: 400 })

  const stateRef = adminDb.collection('gsc_oauth_states').doc(state)
  const stateSnap = await stateRef.get()
  if (!stateSnap.exists) return NextResponse.json({ success: false, error: 'invalid state' }, { status: 400 })
  const stateData = stateSnap.data() ?? {}
  const expiresAt = timestampToMillis(stateData.expiresAt)
  if (
    stateData.consumedAt ||
    stateData.sprintId !== parsed.sprintId ||
    stateData.uid !== parsed.uid ||
    !expiresAt ||
    expiresAt < Date.now()
  ) {
    return NextResponse.json({ success: false, error: 'invalid state' }, { status: 400 })
  }

  // Need orgId to encrypt
  const sprintSnap = await adminDb.collection('seo_sprints').doc(parsed.sprintId).get()
  if (!sprintSnap.exists) return NextResponse.json({ success: false, error: 'sprint not found' }, { status: 404 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sprint = sprintSnap.data() as any

  const tokens = await exchangeGscCode(code)
  // Encrypt the whole token bundle at rest using org-scoped key
  const encryptedTokens = encryptCredentials(
    {
      refresh_token: tokens.refresh_token ?? null,
      access_token: tokens.access_token ?? null,
      expiry_date: tokens.expiry_date ?? null,
      scope: tokens.scope ?? null,
    },
    sprint.orgId,
  )

  await adminDb
    .collection('seo_sprints')
    .doc(parsed.sprintId)
    .update({
      'integrations.gsc.connected': true,
      'integrations.gsc.tokens': encryptedTokens,
      'integrations.gsc.tokenStatus': 'valid',
      'integrations.gsc.connectedAt': FieldValue.serverTimestamp(),
      'integrations.gsc.scopes': tokens.scope ? tokens.scope.split(' ') : [],
    })
  await stateRef.update({ consumedAt: FieldValue.serverTimestamp() })

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'
  return NextResponse.redirect(`${base}/admin/seo/sprints/${parsed.sprintId}/settings?gsc=connected`)
}
