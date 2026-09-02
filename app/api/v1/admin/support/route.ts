import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { listAdminSupportTickets } from '@/lib/support/store'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId')?.trim() || searchParams.get('sourceCompanyId')?.trim() || undefined
  const tickets = await listAdminSupportTickets(user.allowedOrgIds, companyId)
  return apiSuccess(tickets)
})
