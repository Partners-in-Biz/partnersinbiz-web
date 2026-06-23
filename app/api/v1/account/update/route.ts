// app/api/v1/account/update/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { resolvePortalActiveOrgId } from '@/lib/portal/org-access'

export const dynamic = 'force-dynamic'

const MAX_LEN = 120

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const POST = withPortalAuth(async (req: NextRequest, uid: string) => {
  try {
    const userRef = adminDb.collection('users').doc(uid)
    const userDoc = await userRef.get()
    if (!userDoc.exists) return apiError('User not found', 404)
    const orgId = await resolvePortalActiveOrgId(uid, userDoc.data()!)
    if (!orgId) return apiError('No active workspace', 400)

    const body = await req.json().catch(() => ({}))
    const firstName = str(body.firstName)
    const lastName = str(body.lastName)
    const phone = str(body.phone)
    const timezone = str(body.timezone)
    const avatarUrl = str(body.avatarUrl)

    if (!firstName) return apiError('First name is required', 400)
    if (firstName.length > MAX_LEN || lastName.length > MAX_LEN) {
      return apiError('Name is too long', 400)
    }
    if (phone && phone.length > 40) return apiError('Phone number is too long', 400)
    if (phone && !/^[+0-9()\-.\s]{4,40}$/.test(phone)) {
      return apiError('Phone number contains invalid characters', 400)
    }
    if (avatarUrl && !/^https?:\/\//.test(avatarUrl)) {
      return apiError('Invalid avatar URL', 400)
    }
    if (timezone && timezone.length > 64) return apiError('Invalid timezone', 400)

    const memberRef = adminDb.collection('orgMembers').doc(`${orgId}_${uid}`)
    const memberDoc = await memberRef.get()

    await memberRef.set(
      {
        orgId,
        uid,
        firstName,
        lastName,
        phone,
        avatarUrl,
        ...(!memberDoc.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    // Timezone is account-level, lives on the users doc (org-independent).
    await userRef.set(
      { timezone, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )

    return apiSuccess({
      profile: { firstName, lastName, phone, avatarUrl, timezone },
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
