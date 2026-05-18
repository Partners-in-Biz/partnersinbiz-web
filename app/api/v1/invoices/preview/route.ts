// app/api/v1/invoices/preview/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { generateInvoiceHtml } from '@/lib/invoices/html-generator'
import { apiError } from '@/lib/api/response'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/invoices/preview
 *
 * Accepts an invoice-like payload and returns rendered HTML for preview.
 * Does NOT create an invoice — purely for preview purposes.
 */
export const POST = withAuth('admin', async (req, user) => {
  const body = await req.json().catch(() => ({}))

  // If orgId provided, enrich with real org billing data
  let fromDetails = body.fromDetails ?? { companyName: 'Partners in Biz' }
  let clientDetails = body.clientDetails ?? { name: body.orgId ?? 'Client' }

  if (body.orgId) {
    if (!canAccessOrg(user, body.orgId)) return apiError('Forbidden', 403)

    // Fetch client org details
    const clientDoc = await adminDb.collection('organizations').doc(body.orgId).get()
    if (clientDoc.exists) {
      const clientOrg = clientDoc.data()!
      const cb = clientOrg.billingDetails ?? {}
      clientDetails = {
        name: clientOrg.name,
        address: cb.address ?? undefined,
        email: clientOrg.billingEmail ?? clientOrg.settings?.notificationEmail ?? undefined,
        vatNumber: cb.vatNumber ?? undefined,
      }
    }

    // Fetch platform owner details
    const platformSnap = await adminDb
      .collection('organizations')
      .where('type', '==', 'platform_owner')
      .limit(1)
      .get()

    if (!platformSnap.empty) {
      const platform = platformSnap.docs[0].data()
      const pb = platform.billingDetails ?? {}
      fromDetails = {
        companyName: platform.name,
        address: pb.address ?? undefined,
        email: platform.billingEmail ?? platform.settings?.notificationEmail ?? undefined,
        phone: pb.phone ?? undefined,
        vatNumber: pb.vatNumber ?? undefined,
        registrationNumber: pb.registrationNumber ?? undefined,
        website: platform.website ?? undefined,
        logoUrl: platform.brandProfile?.logoUrl ?? platform.logoUrl ?? undefined,
        bankingDetails: pb.bankingDetails ?? undefined,
      }
    }
  }

  const invoice = {
    ...body,
    fromDetails,
    clientDetails,
  }

  const html = generateInvoiceHtml(invoice)

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
})
