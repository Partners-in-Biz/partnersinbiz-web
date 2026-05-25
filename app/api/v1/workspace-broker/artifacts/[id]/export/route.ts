import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { createBrokerJob } from '@/lib/workspace-os/brokerRoute'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  return createBrokerJob(req, user, 'export_pdf', { artifactId: id })
})
