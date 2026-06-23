// app/api/v1/portal/growth-onboarding/route.ts
//
// Persists the growth-onboarding wizard completion flag on the organisation.
// Stored at organizations.{orgId}.settings.growthOnboarding so it survives
// across sessions and is independent of the (life-OS) /portal/first-run flow.
//
// GET   -> current { completed, completedAt }
// PATCH -> set { growthOnboardingCompleted: boolean } (member+)

import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'

import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

type GrowthOnboarding = {
  completed: boolean
  completedAt: string | null
}

function readGrowthOnboarding(settings: Record<string, unknown> | undefined): GrowthOnboarding {
  const raw = (settings?.growthOnboarding ?? {}) as Record<string, unknown>
  return {
    completed: raw.completed === true,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
  }
}

export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid: string, orgId: string) => {
  try {
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    if (!orgDoc.exists) return apiError('Organisation not found', 404)
    const settings = (orgDoc.data()?.settings ?? {}) as Record<string, unknown>
    return apiSuccess({ growthOnboarding: readGrowthOnboarding(settings) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PATCH = withPortalAuthAndRole('member', async (req: NextRequest, _uid: string, orgId: string) => {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const completed = body.growthOnboardingCompleted === true

    const orgRef = adminDb.collection('organizations').doc(orgId)
    const orgDoc = await orgRef.get()
    if (!orgDoc.exists) return apiError('Organisation not found', 404)

    const next: GrowthOnboarding = {
      completed,
      completedAt: completed ? new Date().toISOString() : null,
    }

    await orgRef.set(
      { settings: { growthOnboarding: next }, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )

    return apiSuccess({ growthOnboarding: next })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
