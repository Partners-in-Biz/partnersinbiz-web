import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withCrmAuth, type CrmAuthContext } from '@/lib/auth/crm-middleware'
import { createPartnerInvite, listPartnerInvites } from '@/lib/partner-links/store'
import { cleanString, normalizeEmail } from '@/lib/partner-links/identity'
import type { PartnerInviteKind } from '@/lib/partner-links/types'
import { partnerInviteEmail } from '@/lib/email/templates/partner-invite'
import { sendEmail } from '@/lib/email/send'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'

export const dynamic = 'force-dynamic'

const VALID_CAPABILITIES: SharedBusinessCapability[] = [
  'crm', 'projects', 'documents', 'orders', 'shipments',
  'inventory', 'invoices', 'analytics', 'support', 'services',
]

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'
}

function parseCapabilities(value: unknown): SharedBusinessCapability[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value
    .map((v) => cleanString(v))
    .filter((v): v is SharedBusinessCapability =>
      (VALID_CAPABILITIES as string[]).includes(v))
  return out.length > 0 ? out : undefined
}

export const GET = withCrmAuth('viewer', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const status = cleanString(req.nextUrl.searchParams.get('status')) || undefined
    const limitRaw = Number(req.nextUrl.searchParams.get('limit'))
    const invites = await listPartnerInvites(ctx.orgId, {
      status,
      limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
    })
    // The token is a bearer credential — never leak it on a list read.
    return apiSuccess({
      invites: invites.map((invite) => ({ ...invite, inviteToken: undefined })),
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const POST = withCrmAuth('member', async (req: NextRequest, ctx: CrmAuthContext) => {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>

    const kind: PartnerInviteKind = cleanString(body.kind) === 'contact' ? 'contact' : 'company'
    const companyId = cleanString(body.companyId)
    let contactId = cleanString(body.contactId)
    if (!companyId && !contactId) return apiError('companyId or contactId is required', 400)

    // Resolve + tenant-check the contact first; it can supply the company.
    let contactData: Record<string, unknown> | null = null
    if (contactId) {
      const snap = await adminDb.collection('contacts').doc(contactId).get()
      if (!snap.exists) return apiError('Contact not found', 404)
      contactData = snap.data() ?? {}
      if (contactData.orgId !== ctx.orgId) return apiError('Contact not found', 404)
    }

    const resolvedCompanyId = companyId || cleanString(contactData?.companyId)
    if (!resolvedCompanyId) {
      return apiError('That contact is not linked to a company yet — add a company first', 400)
    }

    const companySnap = await adminDb.collection('companies').doc(resolvedCompanyId).get()
    if (!companySnap.exists) return apiError('Company not found', 404)
    const companyData = companySnap.data() ?? {}
    if (companyData.orgId !== ctx.orgId) return apiError('Company not found', 404)
    if (companyData.deleted === true) return apiError('Company not found', 404)

    const alreadyLinked = cleanString(companyData.linkedOrgId)
    if (alreadyLinked) {
      return apiError('That company is already linked to a workspace. Unlink it first.', 409, {
        linkedOrgId: alreadyLinked,
      })
    }

    const recipientEmail = normalizeEmail(body.email) || normalizeEmail(contactData?.email)
    if (!recipientEmail || !recipientEmail.includes('@')) {
      return apiError('A valid recipient email is required', 400)
    }
    if (kind === 'contact' && !contactId) {
      return apiError('contactId is required for a contact invite', 400)
    }
    if (kind === 'company') contactId = ''

    // Inviting human, mirrored into the acceptor's CRM as a contact.
    let inviterEmail = ''
    if (ctx.uid && !ctx.isAgent) {
      const userSnap = await adminDb.collection('users').doc(ctx.uid).get()
      inviterEmail = normalizeEmail((userSnap.data() ?? {}).email)
    }
    const orgSnap = await adminDb.collection('organizations').doc(ctx.orgId).get()
    const orgData = orgSnap.data() ?? {}
    const inviterOrgName = cleanString(orgData.name) || ctx.orgId

    // Agent-created invites have no human inviter. Fall back to the org's own
    // contact address so the acceptor still gets a reciprocal contact record —
    // without it the link would be company↔company only in that direction.
    if (!inviterEmail) {
      const settings = (orgData.settings ?? {}) as Record<string, unknown>
      inviterEmail = normalizeEmail(orgData.billingEmail) || normalizeEmail(settings.notificationEmail)
    }
    const inviterDisplayName = ctx.isAgent || !ctx.actor.displayName
      ? inviterOrgName
      : ctx.actor.displayName

    const { invite, created } = await createPartnerInvite({
      kind,
      sourceOrgId: ctx.orgId,
      sourceCompanyId: resolvedCompanyId,
      sourceContactId: contactId || undefined,
      recipientEmail,
      recipientName: cleanString(body.name) || cleanString(contactData?.name) || undefined,
      recipientCompanyName: cleanString(body.companyName) || cleanString(companyData.name) || undefined,
      message: cleanString(body.message) || undefined,
      capabilities: parseCapabilities(body.capabilities),
      fieldSharingPolicy: body.fieldSharingPolicy && typeof body.fieldSharingPolicy === 'object'
        ? body.fieldSharingPolicy as Record<string, boolean>
        : undefined,
      actor: ctx.actor,
      inviterUserId: ctx.isAgent ? undefined : ctx.uid,
      inviterEmail: inviterEmail || undefined,
      inviterName: inviterDisplayName,
    })

    const acceptUrl = `${baseUrl()}/partners/invite/${invite.inviteToken}`
    const { subject, html } = partnerInviteEmail({
      inviterOrgName,
      inviterName: ctx.isAgent ? undefined : ctx.actor.displayName,
      recipientName: invite.recipientName,
      acceptUrl,
      message: invite.message,
      expiresAt: invite.expiresAt,
    })
    const emailResult = await sendEmail({ to: recipientEmail, subject, html })

    return apiSuccess({
      invite: { ...invite, inviteToken: undefined },
      acceptUrl,
      reused: !created,
      emailSent: emailResult.success,
      emailError: emailResult.error,
    }, created ? 201 : 200)
  } catch (err) {
    return apiErrorFromException(err)
  }
})
