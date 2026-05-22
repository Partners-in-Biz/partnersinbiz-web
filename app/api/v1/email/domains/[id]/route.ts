/**
 * GET    /api/v1/email/domains/[id]  — refresh status from Resend, return domain
 * DELETE /api/v1/email/domains/[id]  — soft-delete + remove from Resend
 *
 * Auth: admin
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { getResendClient } from '@/lib/email/resend'
import type { EmailDomain, EmailDomainDnsRecord } from '@/lib/email/domains'
import type { ApiUser } from '@/lib/api/types'

type Params = { params: Promise<{ id: string }> }

export const GET = withAuth('client', async (_req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params

  const snap = await adminDb.collection('email_domains').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Domain not found', 404)
  const scope = resolveOrgScope(user, (snap.data()?.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const doc = { id: snap.id, ...snap.data() } as EmailDomain

  // Refresh from Resend
  const resend = getResendClient()
  const { data, error } = await resend.domains.get(doc.resendDomainId)
  if (error || !data) {
    return apiError(error?.message ?? 'Resend lookup failed', 502)
  }

  const dnsRecords: EmailDomainDnsRecord[] = ((data as { records?: EmailDomainDnsRecord[] }).records ?? []).map((r) => ({
    record: r.record,
    name: r.name,
    type: r.type,
    ttl: r.ttl,
    status: r.status,
    value: r.value,
    priority: r.priority,
  }))

  await snap.ref.update({
    status: data.status ?? doc.status,
    dnsRecords,
    lastSyncedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return apiSuccess({ ...doc, status: data.status, dnsRecords })
})

export const DELETE = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params

  const snap = await adminDb.collection('email_domains').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Domain not found', 404)
  const scope = resolveOrgScope(user, (snap.data()?.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const capabilityError = enforceAgentCapability(user, 'delete', req)
  if (capabilityError) return capabilityError
  const doc = snap.data() as EmailDomain

  // Best-effort remove from Resend; soft-delete locally either way
  if (doc.resendDomainId) {
    try {
      await getResendClient().domains.remove(doc.resendDomainId)
    } catch (err) {
      console.warn('[email-domains] resend remove failed', err)
    }
  }

  await snap.ref.update({ deleted: true, updatedAt: FieldValue.serverTimestamp() })
  return apiSuccess({ id })
})
