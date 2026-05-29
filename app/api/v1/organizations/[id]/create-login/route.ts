/**
 * POST /api/v1/organizations/[id]/create-login
 *
 * Creates a Firebase Auth account for a client, stores them in Firestore with
 * role "client", adds them to the organisation as a member, and returns a
 * password-setup link the admin can forward to the client.
 */
import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { Organization, OrgMember, OrgRole } from '@/lib/organizations/types'
import { getResendClient, FROM_ADDRESS } from '@/lib/email/resend'
import { ACCESS_SCOPE_OPTIONS, parseMemberMetadata } from '@/lib/organizations/memberMetadata'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

function splitName(displayName: string) {
  const [firstName = '', ...rest] = displayName.trim().split(/\s+/).filter(Boolean)
  return { firstName, lastName: rest.join(' ') }
}

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { id } = await (ctx as Params).params

  const body = await req.json().catch(() => ({}))
  const email: string = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name: string = typeof body.name === 'string' ? body.name.trim() : ''
  const role: string = body.role ?? 'member'
  const memberMetadata = parseMemberMetadata(body)

  if (!email) return apiError('email is required', 400)
  if (!name) return apiError('name is required', 400)

  const validRoles = ['owner', 'admin', 'member', 'viewer']
  if (!validRoles.includes(role)) {
    return apiError(`role must be one of: ${validRoles.join(', ')}`, 400)
  }
  if (typeof body.accessScope === 'string' && !ACCESS_SCOPE_OPTIONS.includes(body.accessScope as never)) {
    return apiError(`accessScope must be one of: ${ACCESS_SCOPE_OPTIONS.join(', ')}`, 400)
  }

  // Fetch organisation
  const orgDoc = await adminDb.collection('organizations').doc(id).get()
  if (!orgDoc.exists) return apiError('Organisation not found', 404)
  const org = orgDoc.data() as Organization

  // Check if Firebase Auth user already exists
  let uid: string
  try {
    const existing = await adminAuth.getUserByEmail(email)
    uid = existing.uid
    // User exists in Auth — check if already in org
    const alreadyMember = (org.members ?? []).some((m) => m.userId === uid)
    if (alreadyMember) return apiError('This user is already a member of this organisation', 409)
  } catch (err: unknown) {
    if (!(typeof err === 'object' && err && 'code' in err && err.code === 'auth/user-not-found')) throw err

    // Create new Firebase Auth user (no password — they'll set it via the reset link)
    const created = await adminAuth.createUser({ email, displayName: name })
    uid = created.uid

    // New user — set orgId (primary) and orgIds array
    await adminDb.collection('users').doc(uid).set({
      email,
      displayName: name,
      role: 'client',
      orgId: id,
      orgIds: [id],
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  // For existing users: add this org to their orgIds array without overwriting
  // their primary orgId (so their active workspace is unchanged).
  const existingUserDoc = await adminDb.collection('users').doc(uid).get()
  const existingData = existingUserDoc.data() ?? {}
  const existingOrgIds: string[] = Array.isArray(existingData.orgIds) ? existingData.orgIds : (existingData.orgId ? [existingData.orgId] : [])
  if (!existingOrgIds.includes(id)) {
    await adminDb.collection('users').doc(uid).set(
      {
        orgIds: [...existingOrgIds, id],
        // Keep orgId as primary; set it only if the user had none before
        ...(existingData.orgId ? {} : { orgId: id }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  }

  // Add to organisation members
  const newMember: OrgMember = {
    userId: uid,
    role: role as OrgRole,
    joinedAt: Timestamp.now(),
    invitedBy: user.uid,
    ...memberMetadata,
  }
  await adminDb.collection('organizations').doc(id).update({
    members: [...(org.members ?? []), newMember],
    updatedAt: FieldValue.serverTimestamp(),
  })

  const { firstName, lastName } = splitName(name)
  await adminDb.collection('orgMembers').doc(`${id}_${uid}`).set(
    {
      orgId: id,
      uid,
      firstName,
      lastName,
      avatarUrl: existingData.photoURL ?? '',
      role,
      ...memberMetadata,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  // Generate a password-setup link wrapped in a proxy page.
  // The proxy page (/auth/reset?link=...) shows a button the user must click,
  // preventing email scanners from pre-fetching and invalidating the one-time token.
  // continueUrl sends the client to the login page after they set their password.
  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'
  let setupLink: string | null = null
  try {
    const firebaseLink = await adminAuth.generatePasswordResetLink(email, {
      url: `${BASE_URL}/login`,
    })
    setupLink = `${BASE_URL}/auth/reset?link=${encodeURIComponent(firebaseLink)}`
  } catch {
    // Non-fatal — admin can trigger reset manually from login page
  }

  // Fire-and-forget welcome email (only when we have a setup link AND the
  // request explicitly opts in via `sendWelcomeEmail !== false`)
  const sendWelcome = body.sendWelcomeEmail !== false
  if (sendWelcome && setupLink) {
    try {
      await sendWelcomeEmail({
        to: email,
        name,
        orgName: org.name ?? 'your workspace',
        setupLink,
      })
    } catch (err) {
      console.error('[create-login] welcome email failed', err)
    }
  }

  return apiSuccess({ uid, email, displayName: name, role, setupLink, ...memberMetadata }, 201)
})

// ── Welcome email template ───────────────────────────────────────────────────

interface WelcomeEmailInput {
  to: string
  name: string
  orgName: string
  setupLink: string
}

async function sendWelcomeEmail(input: WelcomeEmailInput) {
  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'
  const portalUrl = `${BASE_URL}/portal/dashboard`
  const greeting = input.name?.split(' ')[0] ?? 'there'

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#fafafa;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:520px;margin:40px auto;padding:0 24px;">
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;">
      <h1 style="font-size:20px;color:#111;margin:0 0 16px 0;">Your campaigns workspace is ready</h1>
      <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 16px 0;">
        Hi ${escapeHtml(greeting)} — your workspace for <strong>${escapeHtml(input.orgName)}</strong>
        on Partners in Biz is set up and waiting for you.
      </p>
      <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 24px 0;">
        Click the button below to set your password and sign in. From the portal you can
        manage contacts, run email campaigns, and capture new leads.
      </p>
      <p style="text-align:center;margin:0 0 24px 0;">
        <a href="${escapeAttr(input.setupLink)}"
           style="display:inline-block;padding:12px 24px;background:#F59E0B;color:#111;text-decoration:none;font-weight:600;border-radius:8px;">
          Set password &amp; sign in
        </a>
      </p>
      <p style="font-size:12px;line-height:1.5;color:#6b7280;margin:0;">
        Or paste this link in your browser:<br>
        <a href="${escapeAttr(input.setupLink)}" style="color:#6b7280;word-break:break-all;">${escapeAttr(input.setupLink)}</a>
      </p>
    </div>
    <p style="font-size:11px;color:#9ca3af;text-align:center;margin-top:16px;">
      After signing in, your workspace lives at <a href="${escapeAttr(portalUrl)}" style="color:#9ca3af;">${escapeAttr(portalUrl)}</a>.
    </p>
  </div>
</body></html>`

  const text = `Hi ${greeting},

Your workspace for ${input.orgName} on Partners in Biz is ready.

Set your password and sign in: ${input.setupLink}

After signing in, your workspace will be at ${portalUrl}.`

  await getResendClient().emails.send({
    from: FROM_ADDRESS,
    to: input.to,
    subject: `Your ${input.orgName} workspace is ready`,
    html,
    text,
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;')
}
