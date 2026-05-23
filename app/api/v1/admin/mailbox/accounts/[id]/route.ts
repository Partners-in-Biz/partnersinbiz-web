import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { encryptCredentials } from '@/lib/integrations/crypto'
import { serializeAccount } from '@/lib/mailbox/serializers'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

function toPort(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : undefined
}

function buildServerConfig(input: unknown) {
  if (!input || typeof input !== 'object') return undefined
  const data = input as Record<string, unknown>
  const host = typeof data.host === 'string' ? data.host.trim() : ''
  const port = toPort(data.port)
  const username = typeof data.username === 'string' ? data.username.trim() : ''
  const password = typeof data.password === 'string' ? data.password : ''
  if (!host && !port && !username && !password) return null
  if (!host || !port || !username || !password) throw new Error('Host, port, username and password are required')
  return { host, port, username, password, secure: data.secure !== false }
}

async function loadOwnedAccount(id: string, orgId: string, uid: string) {
  const ref = adminDb.collection('mailbox_accounts').doc(id)
  const doc = await ref.get()
  if (!doc.exists) return null
  const data = doc.data() ?? {}
  if (data.orgId !== orgId || data.uid !== uid) return null
  return { ref, doc, data }
}

async function clearDefault(orgId: string, uid: string) {
  const snap = await adminDb.collection('mailbox_accounts').where('orgId', '==', orgId).where('uid', '==', uid).get()
  await Promise.all(snap.docs.map((doc) => doc.ref.update({ isDefault: false, updatedAt: FieldValue.serverTimestamp() })))
}

export const PATCH = withAuth('admin', async (req: NextRequest, user, ctx: Ctx) => {
  try {
    const orgId = PIB_PLATFORM_ORG_ID
    const uid = user.uid
    const { id } = await ctx.params
    const owned = await loadOwnedAccount(id, orgId, uid)
    if (!owned) return apiError('Email account not found', 404)

    const body = await req.json().catch(() => ({}))
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    if (typeof body.displayName === 'string') patch.displayName = body.displayName.trim()
    if (body.isDefault === true) {
      await clearDefault(orgId, uid)
      patch.isDefault = true
    }

    const smtp = buildServerConfig(body.smtp)
    const imap = buildServerConfig(body.imap)
    if (smtp) patch.smtpEnc = encryptCredentials(smtp, orgId)
    if (imap) patch.imapEnc = encryptCredentials(imap, orgId)
    if (smtp || imap) patch.status = 'connected'

    await owned.ref.set(patch, { merge: true })
    const fresh = await owned.ref.get()
    return apiSuccess({ account: serializeAccount(id, fresh.data() ?? {}) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const DELETE = withAuth('admin', async (_req: NextRequest, user, ctx: Ctx) => {
  try {
    const orgId = PIB_PLATFORM_ORG_ID
    const uid = user.uid
    const { id } = await ctx.params
    const owned = await loadOwnedAccount(id, orgId, uid)
    if (!owned) return apiError('Email account not found', 404)
    await owned.ref.update({ deletedAt: FieldValue.serverTimestamp(), status: 'needs_setup', isDefault: false })
    return apiSuccess({ id })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
