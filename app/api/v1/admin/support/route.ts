import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { listAdminSupportTickets } from '@/lib/support/store'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (_req: NextRequest, user: ApiUser) => {
  const tickets = await listAdminSupportTickets(user.allowedOrgIds)
  return apiSuccess(tickets)
})
