/**
 * GET  /api/v1/portal/referrals   — portal-facing referral programme view.
 * POST /api/v1/portal/referrals   — (re)fetch / create this org's referral code.
 *
 * The admin side already owns the `referrals` ledger (one doc per
 * referrer→referred relationship) and the `billing_config/referrals` settings.
 * This portal route is referrer-scoped: it returns the org's own unique
 * referral code + link, its referral stats, and the live programme settings so
 * the portal can render "how it works" with the real credit amounts.
 *
 * Referral codes live in the `referral_codes` collection, keyed by orgId. A
 * code is created lazily on first GET/POST and is stable thereafter.
 *
 * Credits are EFT-first — referral credit is applied off-platform on the next
 * EFT invoice, never via a card processor.
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { tsToMillis } from '@/lib/billing/format'
import type { Referral, ReferralSettings } from '@/lib/billing/types'

export const dynamic = 'force-dynamic'

const CODES = 'referral_codes'
const REFERRALS = 'referrals'
const SETTINGS_DOC = adminDb.collection('billing_config').doc('referrals')
const PUBLIC_BASE = 'https://partnersinbiz.online'

const DEFAULT_SETTINGS: ReferralSettings = {
  referrerCreditZar: 500,
  referredCreditZar: 250,
  requireApproval: true,
  minPaidInvoices: 1,
  active: true,
}

// Unambiguous alphabet (no 0/O/1/I) for human-shareable codes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

async function loadSettings(): Promise<ReferralSettings> {
  const snap = await SETTINGS_DOC.get()
  if (!snap.exists) return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<ReferralSettings>) }
}

function randomCode(len = 8): string {
  let out = ''
  for (let i = 0; i < len; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return out
}

async function generateUniqueCode(): Promise<string> {
  // Collisions are astronomically unlikely (32^8) but verified regardless.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = randomCode(8)
    const clash = await adminDb.collection(CODES).where('code', '==', code).limit(1).get()
    if (clash.empty) return code
  }
  // Fall back to a longer code if the short space somehow clashed repeatedly.
  return randomCode(12)
}

interface CodeRecord {
  orgId: string
  code: string
  link: string
}

async function ensureCode(orgId: string): Promise<CodeRecord> {
  const ref = adminDb.collection(CODES).doc(orgId)
  const snap = await ref.get()
  if (snap.exists) {
    const data = snap.data() as { code?: string }
    if (typeof data.code === 'string' && data.code) {
      return { orgId, code: data.code, link: `${PUBLIC_BASE}/r/${data.code}` }
    }
  }
  const code = await generateUniqueCode()
  await ref.set(
    {
      orgId,
      code,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  return { orgId, code, link: `${PUBLIC_BASE}/r/${code}` }
}

interface ReferralStatRow {
  id: string
  referredName: string
  status: Referral['status']
  creditZar: number
  createdAtMs: number | null
}

async function loadStats(orgId: string, settings: ReferralSettings) {
  // Single-field query: all referrals this org referred.
  const snap = await adminDb.collection(REFERRALS).where('referrerOrgId', '==', orgId).get()

  const rows: ReferralStatRow[] = []
  let signedUp = 0
  let converted = 0
  let creditEarnedZar = 0
  let creditPendingZar = 0
  let creditPaidZar = 0

  for (const doc of snap.docs) {
    const data = doc.data() as Omit<Referral, 'id'>
    const credit = Number(data.creditZar) || 0
    const status = data.status
    // Every recorded referral is a signed-up org (the referred org exists).
    signedUp += 1
    if (status === 'approved' || status === 'paid') {
      converted += 1
      creditEarnedZar += credit
    }
    if (status === 'approved') creditPendingZar += credit
    if (status === 'paid') creditPaidZar += credit
    rows.push({
      id: doc.id,
      referredName: (data.referredName && data.referredName.trim()) || data.referredOrgId,
      status,
      creditZar: credit,
      createdAtMs: tsToMillis(data.createdAt),
    })
  }

  rows.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))

  return {
    stats: {
      // "sent" = invitations the org could send; we surface signedUp+converted as
      // the real, ledgered outcomes. sent is signedUp (every ledger row is a
      // real signup) so the funnel reads sent >= signedUp >= converted.
      sent: signedUp,
      signedUp,
      converted,
      creditEarnedZar,
      creditPendingZar,
      creditPaidZar,
    },
    referrals: rows,
    settings,
  }
}

export const GET = withAuth(
  'client',
  withTenant(async (_req: NextRequest, _user, orgId) => {
    const [code, settings] = await Promise.all([ensureCode(orgId), loadSettings()])
    const data = await loadStats(orgId, settings)
    return apiSuccess({
      orgId,
      code: code.code,
      link: code.link,
      ...data,
    })
  }),
)

export const POST = withAuth(
  'client',
  withTenant(async (_req: NextRequest, _user, orgId) => {
    // POST (re)affirms the org has a code; it never rotates an existing one.
    const code = await ensureCode(orgId)
    return apiSuccess({ orgId, code: code.code, link: code.link }, 201)
  }),
)
