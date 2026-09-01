import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiSuccess } from '@/lib/api/response'
import { brandKitWriteDocId, getBrandKitForOwner } from '@/lib/brand-kit/store'
import { resolveMarketingOwnerFromSearchParams } from '@/lib/social/account-scope'

export const dynamic = 'force-dynamic'

function cleanObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

export const GET = withPortalAuthAndRole('viewer', async (req: NextRequest, uid, orgId) => {
  const owner = resolveMarketingOwnerFromSearchParams(new URL(req.url).searchParams, uid)
  if (owner.owner !== 'org') {
    const kit = await getBrandKitForOwner(orgId, owner)
    return apiSuccess({
      org: {
        id: orgId,
        name: kit.brandName ?? '',
        slug: '',
      },
      brandProfile: {
        brandName: kit.brandName,
        logoUrl: kit.logoUrl,
        logoUrlDark: kit.logoUrlDark,
        faviconUrl: kit.faviconUrl,
        postalAddress: kit.postalAddress,
        brandVoiceId: kit.brandVoiceId,
      },
      brandColors: {
        primary: kit.primaryColor,
        secondary: kit.secondaryColor,
        accent: kit.accentColor,
        background: kit.backgroundColor,
        text: kit.textColor,
        muted: kit.mutedTextColor,
      },
    })
  }
  const doc = await adminDb.collection('organizations').doc(orgId).get()
  if (!doc.exists) return apiError('Organisation not found', 404)

  const data = doc.data() ?? {}
  return apiSuccess({
    org: {
      id: orgId,
      name: data.name ?? '',
      slug: data.slug ?? '',
    },
    brandProfile: data.brandProfile ?? {},
    brandColors: data.settings?.brandColors ?? {},
  })
})

export const PUT = withPortalAuthAndRole('member', async (req: NextRequest, uid, orgId) => {
  const owner = resolveMarketingOwnerFromSearchParams(new URL(req.url).searchParams, uid)
  const body = await req.json().catch(() => ({}))
  const brandProfile = cleanObject(body.brandProfile)
  const brandColors = cleanObject(body.brandColors)

  if (owner.owner !== 'org') {
    const existing = await getBrandKitForOwner(orgId, owner)
    const cleaned = JSON.parse(JSON.stringify({
      ...existing,
      brandName: typeof brandProfile.brandName === 'string' ? brandProfile.brandName : existing.brandName,
      logoUrl: typeof brandProfile.logoUrl === 'string' ? brandProfile.logoUrl : existing.logoUrl,
      logoUrlDark: typeof brandProfile.logoUrlDark === 'string' ? brandProfile.logoUrlDark : existing.logoUrlDark,
      faviconUrl: typeof brandProfile.faviconUrl === 'string' ? brandProfile.faviconUrl : existing.faviconUrl,
      postalAddress: typeof brandProfile.postalAddress === 'string' ? brandProfile.postalAddress : existing.postalAddress,
      brandVoiceId: typeof brandProfile.brandVoiceId === 'string' ? brandProfile.brandVoiceId : existing.brandVoiceId,
      primaryColor: typeof brandColors.primary === 'string' ? brandColors.primary : existing.primaryColor,
      secondaryColor: typeof brandColors.secondary === 'string' ? brandColors.secondary : existing.secondaryColor,
      accentColor: typeof brandColors.accent === 'string' ? brandColors.accent : existing.accentColor,
      backgroundColor: typeof brandColors.background === 'string' ? brandColors.background : existing.backgroundColor,
      textColor: typeof brandColors.text === 'string' ? brandColors.text : existing.textColor,
      mutedTextColor: typeof brandColors.muted === 'string' ? brandColors.muted : existing.mutedTextColor,
      updatedAt: undefined,
    }))
    delete cleaned.updatedAt
    await adminDb.collection('brand_kits').doc(brandKitWriteDocId(orgId, owner)).set({
      ...cleaned,
      orgId,
      marketingOwner: owner.owner,
      ...(owner.companyId ? { companyId: owner.companyId } : {}),
      ...(owner.uid ? { ownerUid: owner.uid } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return apiSuccess({ updated: true })
  }

  const doc = await adminDb.collection('organizations').doc(orgId).get()
  if (!doc.exists) return apiError('Organisation not found', 404)

  const existingSettings = doc.data()?.settings ?? {}

  await adminDb.collection('organizations').doc(orgId).update({
    brandProfile,
    settings: { ...existingSettings, brandColors },
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ updated: true })
})
