/**
 * POST /api/v1/admin/social-credentials/[platform]/rotate
 *
 * Rotation actions for a platform variant. Body { target: 'webhook' | 'secret', note? }.
 *
 *  - target 'webhook' → generates a fresh cryptographically-random webhook
 *    verification token, stores it on the variant's settings doc, stamps
 *    lastRotatedAt, and appends a rotation-log entry. This is a real secret the
 *    platform fully owns, so it is rotated in-place.
 *
 *  - target 'secret' → the OAuth client secret lives in a Vercel env var and
 *    cannot be rotated from a request handler. This records a rotation-intent
 *    log entry (who/when/why) so the env rotation has an audit trail, and
 *    returns the env var name the operator must update in Vercel.
 *
 * Auth: admin. Every rotation is audited.
 */
import { NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { writeAdminAudit } from '@/lib/admin/audit'
import { SETTINGS_COLLECTION, buildCredentialView, findVariant } from '../../_shared'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ platform: string }> }

/** The env var name that holds the client secret for a variant. */
function secretEnvName(key: string, oauthPlatform: string): string {
  if (key === 'linkedin') return 'LINKEDIN_PERSONAL_CLIENT_SECRET'
  if (key === 'linkedin_org') return 'LINKEDIN_ORGANIZATION_CLIENT_SECRET'
  if (oauthPlatform === 'tiktok') return 'TIKTOK_CLIENT_SECRET'
  return `${oauthPlatform.toUpperCase()}_CLIENT_SECRET`
}

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { platform } = await (ctx as RouteContext).params
  const variant = findVariant(platform)
  if (!variant) return apiError('Unknown platform variant', 400)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const target = String(body.target ?? 'webhook')
  if (target !== 'webhook' && target !== 'secret') {
    return apiError("target must be 'webhook' or 'secret'", 400)
  }
  const note = String(body.note ?? '').trim()
  const ref = adminDb.collection(SETTINGS_COLLECTION).doc(variant.key)
  const now = FieldValue.serverTimestamp()

  if (target === 'webhook') {
    const newToken = `whk_${randomBytes(24).toString('hex')}`
    const logEntry = {
      at: new Date().toISOString(),
      actorUid: user.uid,
      note: note || 'Webhook verification token rotated',
    }
    const existing = await ref.get()
    await ref.set(
      {
        key: variant.key,
        webhookToken: newToken,
        lastRotatedAt: now,
        rotationLog: FieldValue.arrayUnion(logEntry),
        updatedAt: now,
        updatedBy: user.uid,
        ...(existing.exists ? {} : { createdAt: now }),
      },
      { merge: true },
    )

    await writeAdminAudit(user, {
      action: 'social_credential.rotate_webhook',
      summary: `Rotated webhook token for ${variant.label}`,
      metadata: { key: variant.key, note: note || null },
    })

    const saved = await ref.get()
    const view = buildCredentialView(variant, saved.data() as Record<string, unknown>)
    // Return the new token ONCE in the clear so the operator can copy it.
    return apiSuccess({ ...view, newWebhookToken: newToken, target: 'webhook' })
  }

  // target === 'secret' — record intent; env rotation happens in Vercel.
  const envName = secretEnvName(variant.key, variant.oauthPlatform)
  const logEntry = {
    at: new Date().toISOString(),
    actorUid: user.uid,
    note: note || `Client secret rotation requested — update ${envName} in Vercel`,
  }
  const existing = await ref.get()
  await ref.set(
    {
      key: variant.key,
      lastRotatedAt: now,
      rotationLog: FieldValue.arrayUnion(logEntry),
      updatedAt: now,
      updatedBy: user.uid,
      ...(existing.exists ? {} : { createdAt: now }),
    },
    { merge: true },
  )

  await writeAdminAudit(user, {
    action: 'social_credential.rotate_secret_intent',
    summary: `Client secret rotation requested for ${variant.label} (${envName})`,
    metadata: { key: variant.key, envName, note: note || null },
  })

  const saved = await ref.get()
  const view = buildCredentialView(variant, saved.data() as Record<string, unknown>)
  return apiSuccess({
    ...view,
    target: 'secret',
    envName,
    instruction: `Update ${envName} in the Vercel project env, then redeploy. This entry records the rotation request.`,
  })
})
