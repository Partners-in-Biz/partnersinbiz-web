/**
 * GET /api/v1/reports/client-value — lifetime paid value per client org.
 *
 * Query params:
 *   orgId (required) — NOTE: this is the billing org (platform owner), not
 *                      the client. Invoice schema uses `orgId` to refer to
 *                      the CLIENT (see app/api/v1/invoices/route.ts POST —
 *                      body.orgId is the client org). We have no back-reference
 *                      from invoice to billing org today, so this report
 *                      aggregates ALL paid invoices in the system and groups
 *                      them by the invoice's `orgId` (client), using the
 *                      snapshotted `clientDetails.name` for display.
 *   limit (optional, default 20, max 100) — top N clients to return
 *
 * Auth: admin (AI/admin)
 */
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

function toDateSafe(v: unknown): Date | null {
  if (!v) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyV = v as any
  if (typeof anyV?.toDate === 'function') return anyV.toDate()
  if (anyV instanceof Date) return anyV
  if (typeof anyV === 'string' || typeof anyV === 'number') {
    const d = new Date(anyV)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof anyV?._seconds === 'number') return new Date(anyV._seconds * 1000)
  return null
}

type ClientAgg = {
  clientOrgId: string
  clientName: string
  lifetimeValue: number
  invoiceCount: number
  lastInvoiceAt: string | null
}

export const GET = withAuth('admin', async (req, user) => {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('orgId')
  if (!orgId) return apiError('orgId is required; pass it as a query param', 400)

  const limitRaw = parseInt(searchParams.get('limit') ?? '20', 10)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 20, 1), 100)

  try {
    // All paid invoices — grouped by invoice.orgId (the client).
    // Assumption: the platform owner queries this on themselves, and invoices
    // in the `invoices` collection belong to clients they bill. If we grow
    // multi-platform later we'll add a `billingOrgId` field and filter here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snapshot: any = await adminDb
      .collection('invoices')
      .where('status', '==', 'paid')
      .get()

    if (snapshot.empty) {
      return apiSuccess({ clients: [], total: 0 })
    }

    const byClient = new Map<string, ClientAgg>()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshot.docs.forEach((doc: any) => {
      const data = doc.data() ?? {}
      if (data.deleted === true) return
      const clientOrgId = (data.orgId as string) ?? ''
      if (!clientOrgId) return
      if (!canAccessOrg(user, clientOrgId)) return
      const clientName =
        (data.clientDetails?.name as string | undefined) ?? clientOrgId
      const amount = Number(data.total ?? 0)
      const paidAt = toDateSafe(data.paidAt)

      const agg = byClient.get(clientOrgId) ?? {
        clientOrgId,
        clientName,
        lifetimeValue: 0,
        invoiceCount: 0,
        lastInvoiceAt: null,
      }
      agg.lifetimeValue += amount
      agg.invoiceCount += 1
      if (paidAt) {
        const iso = paidAt.toISOString()
        if (!agg.lastInvoiceAt || iso > agg.lastInvoiceAt) agg.lastInvoiceAt = iso
      }
      // Prefer a populated clientName if we see one later.
      if (!agg.clientName || agg.clientName === clientOrgId) agg.clientName = clientName
      byClient.set(clientOrgId, agg)
    })

    const clients = Array.from(byClient.values())
      .sort((a, b) => b.lifetimeValue - a.lifetimeValue)
      .slice(0, limit)

    const totalLifetime = Array.from(byClient.values()).reduce(
      (sum, c) => sum + c.lifetimeValue,
      0,
    )

    return apiSuccess({ clients, total: totalLifetime })
  } catch (err) {
    console.error('[reports/client-value] error:', err)
    return apiError('Failed to build client value report', 500)
  }
})
