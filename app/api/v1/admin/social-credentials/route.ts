/**
 * Social OAuth credential control plane.
 *
 * GET  /api/v1/admin/social-credentials
 *   Returns every platform variant merged from env-backed OAuth facts (masked
 *   client id, secret presence, auth/token/callback URLs, scopes) and the
 *   operator-managed Firestore settings (enabled toggle, API version pin,
 *   webhook token, rotation log, notes).
 *
 * POST /api/v1/admin/social-credentials
 *   Update operator settings for one variant. Body
 *   { key, enabled?, apiVersion?, webhookToken?, notes? }. The OAuth secrets
 *   themselves are NOT editable here — they live in Vercel env vars. Audited.
 *
 * Auth: admin.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { writeAdminAudit } from '@/lib/admin/audit'
import {
  PLATFORM_VARIANTS,
  SETTINGS_COLLECTION,
  buildCredentialView,
  findVariant,
} from './_shared'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async () => {
  const snap = await adminDb.collection(SETTINGS_COLLECTION).get()
  const settingsById = new Map<string, Record<string, unknown>>()
  snap.docs.forEach((doc) => settingsById.set(doc.id, doc.data() as Record<string, unknown>))

  const platforms = PLATFORM_VARIANTS.map((variant) =>
    buildCredentialView(variant, settingsById.get(variant.key) ?? null),
  )

  const summary = {
    total: platforms.length,
    configured: platforms.filter((p) => p.configured).length,
    missing: platforms.filter((p) => !p.configured).length,
    disabled: platforms.filter((p) => !p.enabled).length,
    withWebhookToken: platforms.filter((p) => p.hasWebhookToken).length,
    inboxWebhookSecret: Boolean(process.env.SOCIAL_INBOX_WEBHOOK_SECRET),
  }

  return apiSuccess({ platforms, summary })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return apiError('Invalid JSON body', 400)
  }

  const key = String(body.key ?? '').trim()
  const variant = findVariant(key)
  if (!variant) return apiError('Unknown platform variant', 400)

  const update: Record<string, unknown> = { key, updatedAt: FieldValue.serverTimestamp(), updatedBy: user.uid }
  const changed: string[] = []

  if (body.enabled !== undefined) {
    update.enabled = body.enabled === true || body.enabled === 'true'
    changed.push(`enabled=${update.enabled}`)
  }
  if (body.apiVersion !== undefined) {
    const v = String(body.apiVersion).trim()
    if (v.length > 40) return apiError('apiVersion is too long (max 40 chars)', 400)
    update.apiVersion = v
    changed.push(`apiVersion="${v}"`)
  }
  if (body.webhookToken !== undefined) {
    const token = String(body.webhookToken).trim()
    if (token.length > 256) return apiError('webhookToken is too long (max 256 chars)', 400)
    update.webhookToken = token
    changed.push('webhookToken updated')
  }
  if (body.notes !== undefined) {
    const notes = String(body.notes)
    if (notes.length > 2000) return apiError('notes too long (max 2000 chars)', 400)
    update.notes = notes
    changed.push('notes updated')
  }

  if (changed.length === 0) return apiError('No editable fields supplied', 400)

  const ref = adminDb.collection(SETTINGS_COLLECTION).doc(key)
  const existing = await ref.get()
  await ref.set(
    { ...update, ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }) },
    { merge: true },
  )

  await writeAdminAudit(user, {
    action: 'social_credential.update',
    summary: `Updated social credential settings for ${variant.label}: ${changed.join(', ')}`,
    metadata: { key, changed },
  })

  const saved = await ref.get()
  return apiSuccess(buildCredentialView(variant, saved.data() as Record<string, unknown>))
})
