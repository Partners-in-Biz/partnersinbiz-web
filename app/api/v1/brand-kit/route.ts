// app/api/v1/brand-kit/route.ts
//
// GET ?orgId=…   — returns the BrandKit (defaults if none exists)
// PUT ?orgId=…   — upserts the BrandKit; only known fields are accepted.
//
// One doc per org at `brand_kits/{orgId}`.

import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { FieldValue } from 'firebase-admin/firestore'
import { lastActorFrom } from '@/lib/api/actor'
import { getBrandKitForOrg, getBrandKitForOwner, brandKitWriteDocId } from '@/lib/brand-kit/store'
import { ownerFieldsForWrite, resolveMarketingOwnerFromSearchParams } from '@/lib/social/account-scope'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'
import { defaultBrandKit, type BrandKitSocial } from '@/lib/brand-kit/types'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

function toWire(kit: Awaited<ReturnType<typeof getBrandKitForOrg>>): Record<string, unknown> {
  return {
    ...kit,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updatedAt: (kit.updatedAt as any)?.toDate?.()?.toISOString?.() ?? null,
  }
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const owner = resolveMarketingOwnerFromSearchParams(searchParams, user.uid)
  const kit = await getBrandKitForOwner(scope.orgId, owner)
  return apiSuccess(toWire(kit))
})

export const PUT = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const body = await req.json().catch(() => ({}))
  const requestedOrgId = searchParams.get('orgId') ?? (typeof body?.orgId === 'string' ? body.orgId : null)
  const scope = resolveOrgScope(user, requestedOrgId)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId
  const owner = resolveMarketingOwnerFromSearchParams(searchParams, user.uid)

  // Whitelist-based merge — never accept arbitrary fields. Missing fields
  // fall back to whatever is already in Firestore (or defaults if none).
  const existing = await getBrandKitForOwner(orgId, owner)
  const merged = { ...existing }

  const stringFields: (keyof typeof merged)[] = [
    'brandName',
    'logoUrl',
    'logoUrlDark',
    'faviconUrl',
    'primaryColor',
    'secondaryColor',
    'accentColor',
    'backgroundColor',
    'textColor',
    'mutedTextColor',
    'fontFamilyPrimary',
    'fontFamilyHeadings',
    'defaultFromName',
    'defaultFromLocal',
    'defaultReplyTo',
    'postalAddress',
    'brandVoiceId',
  ]
  for (const f of stringFields) {
    const v = body[f as string]
    if (typeof v === 'string') (merged as Record<string, unknown>)[f as string] = v
  }
  if (typeof body.fontSizeBase === 'number' && Number.isFinite(body.fontSizeBase)) {
    merged.fontSizeBase = body.fontSizeBase
  }
  if (body.social && typeof body.social === 'object' && !Array.isArray(body.social)) {
    const s = body.social as Record<string, unknown>
    const next: BrandKitSocial = {}
    for (const k of ['twitter', 'linkedin', 'instagram', 'facebook', 'youtube', 'tiktok'] as const) {
      if (typeof s[k] === 'string') next[k] = s[k] as string
    }
    merged.social = next
  }
  if (body.customVoice && typeof body.customVoice === 'object' && !Array.isArray(body.customVoice)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    merged.customVoice = body.customVoice as any
  } else if (body.customVoice === null) {
    merged.customVoice = undefined
  }

  // Strip undefined for Firestore (admin SDK rejects them).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cleaned: Record<string, any> = JSON.parse(
    JSON.stringify({ ...defaultBrandKit(orgId), ...merged }),
  )
  cleaned.orgId = orgId
  // Drop the placeholder `updatedAt: null` so the FieldValue.serverTimestamp()
  // below wins (otherwise TS warns about a duplicate key in the literal).
  delete cleaned.updatedAt

  await adminDb.collection('brand_kits').doc(brandKitWriteDocId(orgId, owner)).set(
    {
      ...cleaned,
      ...ownerFieldsForWrite(owner),
      ...clientVisibilityFieldsForWrite(body?.clientVisibility),
      // lastActorFrom() supplies updatedAt + updatedBy + updatedByType.
      ...lastActorFrom(user),
    },
    { merge: true },
  )

  const fresh = await getBrandKitForOwner(orgId, owner)
  return apiSuccess(toWire(fresh))
})
