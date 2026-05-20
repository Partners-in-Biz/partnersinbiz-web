import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { encryptCredentials } from '@/lib/integrations/crypto'
import { normalizeEmail, serializeAccount } from '@/lib/mailbox/serializers'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export const dynamic = 'force-dynamic'

function toPort(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : undefined
}

function buildServerConfig(input: unknown) {
  if (!input || typeof input !== 'object') return null
  const data = input as Record<string, unknown>
  const host = typeof data.host === 'string' ? data.host.trim() : ''
  const port = toPort(data.port)
  const username = typeof data.username === 'string' ? data.username.trim() : ''
  const password = typeof data.password === 'string' ? data.password : ''
  if (!host && !port && !username && !password) return null
  if (!host || !port || !username || !password) {
    throw new Error('Host, port, username and password are required for SMTP/IMAP settings')
  }
  return { host, port, username, password, secure: data.secure !== false }
}

async function clearDefault(orgId: string, uid: string) {
  const snap = await adminDb.collection('mailbox_accounts').where('orgId', '==', orgId).where('uid', '==', uid).get()
  await Promise.all(snap.docs.map((doc) => doc.ref.update({ isDefault: false, updatedAt: FieldValue.serverTimestamp() })))
}

export const GET = withAuth('admin', async (_req: NextRequest, user) => {
  try {
    const orgId = PIB_PLATFORM_ORG_ID
    const uid = user.uid
    const snap = await adminDb.collection('mailbox_accounts').where('orgId', '==', orgId).where('uid', '==', uid).get()
    const accounts = snap.docs
      .filter((doc) => !doc.data().deletedAt)
      .map((doc) => serializeAccount(doc.id, doc.data()))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.emailAddress.localeCompare(b.emailAddress))
    return apiSuccess({ accounts })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  try {
    const orgId = PIB_PLATFORM_ORG_ID
    const uid = user.uid
    const body = await req.json().catch(() => ({}))
    const emailAddress = normalizeEmail(body.emailAddress)
    if (!emailAddress || !emailAddress.includes('@')) return apiError('A valid email address is required', 400)

    const provider = body.provider === 'google' ? 'google' : 'smtp_imap'
    if (provider === 'google') return apiError('Google mailbox accounts must be connected through OAuth.', 400)
    const displayName = typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : emailAddress
    const smtp = buildServerConfig(body.smtp)
    const imap = buildServerConfig(body.imap)

    const ownedAccounts = await adminDb.collection('mailbox_accounts').where('orgId', '==', orgId).where('uid', '==', uid).get()
    const activeOwnedAccounts = ownedAccounts.docs.filter((doc) => !doc.data().deletedAt)
    const existing = activeOwnedAccounts.find((doc) => doc.data().emailAddress === emailAddress)
    if (existing) return apiError('This email account is already linked to your admin profile', 409)

    const shouldDefault = body.isDefault === true || activeOwnedAccounts.length === 0
    if (shouldDefault) await clearDefault(orgId, uid)

    const payload: Record<string, unknown> = {
      orgId,
      uid,
      profileId: `${orgId}_${uid}`,
      provider,
      emailAddress,
      displayName,
      status: smtp || imap ? 'connected' : 'needs_setup',
      isDefault: shouldDefault,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (smtp) payload.smtpEnc = encryptCredentials(smtp, orgId)
    if (imap) payload.imapEnc = encryptCredentials(imap, orgId)

    const ref = await adminDb.collection('mailbox_accounts').add(payload)
    const fresh = await ref.get()
    return apiSuccess({ account: serializeAccount(ref.id, fresh.data() ?? payload) }, 201)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save email account'
    if (message.includes('SMTP/IMAP')) return apiError(message, 400)
    return apiErrorFromException(err)
  }
})
