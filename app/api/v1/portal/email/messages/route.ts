import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isMailboxFolder, serializeAccount, serializeMessage, splitEmails } from '@/lib/mailbox/serializers'
import { sendMailboxMessage } from '@/lib/mailbox/sendBridge'

export const dynamic = 'force-dynamic'

async function loadAccount(accountId: string, orgId: string, uid: string) {
  const doc = await adminDb.collection('mailbox_accounts').doc(accountId).get()
  if (!doc.exists) return null
  const data = doc.data() ?? {}
  if (data.orgId !== orgId || data.uid !== uid || data.deletedAt) return null
  return serializeAccount(doc.id, data)
}

async function defaultAccount(orgId: string, uid: string) {
  const snap = await adminDb.collection('mailbox_accounts').where('orgId', '==', orgId).where('uid', '==', uid).get()
  const accounts = snap.docs
    .filter((doc) => !doc.data().deletedAt)
    .map((doc) => serializeAccount(doc.id, doc.data()))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.emailAddress.localeCompare(b.emailAddress))
  return accounts[0] ?? null
}

export const GET = withPortalAuthAndRole('viewer', async (req: NextRequest, uid: string, orgId: string) => {
  try {
    const { searchParams } = new URL(req.url)
    const folder = isMailboxFolder(searchParams.get('folder')) ? searchParams.get('folder')! : 'inbox'
    const accountId = searchParams.get('accountId')
    const q = (searchParams.get('q') ?? '').trim().toLowerCase()
    const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 50), 1), 100)

    let query = adminDb.collection('mailbox_messages').where('orgId', '==', orgId).where('uid', '==', uid) as FirebaseFirestore.Query
    if (accountId && accountId !== 'all') query = query.where('accountId', '==', accountId)
    const snap = await query.get()
    let messages = snap.docs
      .map((doc) => serializeMessage(doc.id, doc.data()))
      .filter((message) => message.folder === folder)
    if (q) {
      messages = messages.filter((message) =>
        [message.subject, message.from, message.accountEmail, message.snippet, ...message.to].some((value) => value.toLowerCase().includes(q)),
      )
    }
    messages.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    return apiSuccess({ messages: messages.slice(0, limit) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withPortalAuthAndRole('member', async (req: NextRequest, uid: string, orgId: string) => {
  try {
    const body = await req.json().catch(() => ({}))
    const action = body.action === 'draft' ? 'draft' : 'send'
    const account = body.accountId ? await loadAccount(String(body.accountId), orgId, uid) : await defaultAccount(orgId, uid)
    if (!account) return apiError('Link an email account before composing messages', 400)

    const to = splitEmails(body.to)
    const cc = splitEmails(body.cc)
    const bcc = splitEmails(body.bcc)
    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const bodyText = typeof body.bodyText === 'string' ? body.bodyText.trim() : ''
    const bodyHtml = typeof body.bodyHtml === 'string' ? body.bodyHtml : undefined
    if (action === 'send' && to.length === 0) return apiError('At least one recipient is required', 400)
    if (!subject && !bodyText) return apiError('Subject or body is required', 400)

    if (action === 'send') {
      const sendResult = await sendMailboxMessage({
        orgId,
        uid,
        accountId: account.id,
        approved: body.approved === true || body.sendApproved === true,
        dryRun: body.dryRun === true,
        to,
        cc,
        bcc,
        subject,
        bodyText,
        ...(bodyHtml ? { bodyHtml } : {}),
        actorId: uid,
        actorType: 'user',
        approvalGateTaskId: typeof body.approvalGateTaskId === 'string' ? body.approvalGateTaskId : undefined,
      })
      if (!sendResult.ok) return apiError(sendResult.error, 400)
      if (sendResult.dryRun) return apiSuccess({ sendResult }, 200)
      const sentId = sendResult.messageId
      if (!sentId) return apiSuccess({ sendResult }, 201)
      const fresh = await adminDb.collection('mailbox_messages').doc(sentId).get()
      return apiSuccess({ message: serializeMessage(sentId, fresh.data() ?? {}), sendResult }, 201)
    }

    const now = FieldValue.serverTimestamp()
    const payload: Record<string, unknown> = {
      orgId,
      uid,
      profileId: `${orgId}_${uid}`,
      accountId: account.id,
      accountEmail: account.emailAddress,
      folder: 'drafts',
      direction: 'draft',
      status: 'draft',
      read: true,
      starred: false,
      from: account.emailAddress,
      to,
      cc,
      bcc,
      subject,
      bodyText,
      ...(bodyHtml ? { bodyHtml } : {}),
      snippet: bodyText.replace(/\s+/g, ' ').slice(0, 180),
      createdAt: now,
      updatedAt: now,
    }

    const ref = await adminDb.collection('mailbox_messages').add(payload)
    const fresh = await ref.get()
    return apiSuccess({ message: serializeMessage(ref.id, fresh.data() ?? payload) }, 201)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
