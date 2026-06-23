/**
 * GET /api/v1/admin/org/[slug]/billing
 *
 * Read-only billing view: the org's adminBilling block, computed monthly MRR in
 * ZAR, and the 10 most recent invoices for this org. No Stripe — EFT/manual.
 *
 * Auth: super-admin only.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { monthlyRecurringForOrg, toZar } from '@/lib/admin/billing-model'
import { resolveOrgBySlug } from '../route'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ slug: string }> }

function tsToIso(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return value
    return null
  }
  const seconds = (value as { _seconds?: number; seconds?: number })._seconds
    ?? (value as { seconds?: number }).seconds
  if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  return null
}

export const GET = withAuth('admin', async (_req: NextRequest, user, ctx) => {
  if (!isSuperAdmin(user)) return apiError('Super-admin access required', 403)
  const { slug } = await (ctx as RouteContext).params
  const resolved = await resolveOrgBySlug(slug)
  if (!resolved) return apiError('Organisation not found', 404)
  const { id, data: org } = resolved

  const billing = org.adminBilling ?? null
  const monthly = monthlyRecurringForOrg(billing ?? undefined)
  const mrrZar = monthly > 0 ? Math.round(toZar(monthly, billing?.currency)) : 0

  let invoices: Array<Record<string, unknown>> = []
  try {
    const snap = await adminDb.collection('invoices').where('orgId', '==', id).get()
    invoices = snap.docs
      .map((d) => {
        const data = d.data()
        return {
          id: d.id,
          number: typeof data.number === 'string' ? data.number : (typeof data.invoiceNumber === 'string' ? data.invoiceNumber : d.id),
          status: typeof data.status === 'string' ? data.status : 'unknown',
          total: typeof data.total === 'number' ? data.total : 0,
          currency: typeof data.currency === 'string' ? data.currency : 'ZAR',
          issuedAt: tsToIso(data.issuedAt ?? data.createdAt),
          dueAt: tsToIso(data.dueAt ?? data.dueDate),
          paidAt: tsToIso(data.paidAt),
        }
      })
      .sort((a, b) => {
        const at = a.issuedAt ? Date.parse(a.issuedAt as string) : 0
        const bt = b.issuedAt ? Date.parse(b.issuedAt as string) : 0
        return bt - at
      })
      .slice(0, 10)
  } catch {
    invoices = []
  }

  return apiSuccess({
    billing,
    mrrZar,
    monthlyRecurring: monthly,
    invoices,
  })
})
